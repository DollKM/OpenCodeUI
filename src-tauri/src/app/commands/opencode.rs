// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::ServiceState;
use std::{
    process::{Command, Stdio},
    sync::atomic::Ordering,
    time::Duration,
};
use tauri::State;

/// 检查 opencode 服务是否在运行（通过 health endpoint）
pub async fn is_service_running(url: &str) -> bool {
    let health_url = format!("{}/global/health", url.trim_end_matches('/'));
    match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client
            .get(&health_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 构建并执行 Command，返回子进程
fn build_opencode_command(
    binary_path: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Command {
    let mut cmd = Command::new(binary_path);
    cmd.arg("serve").stdout(Stdio::null()).stderr(Stdio::null());

    // 注入用户配置的环境变量
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

/// 当 `name` 是裸名字时，在已知的 npm 全局安装位置中搜索
fn search_npm_global_binary(name: &str) -> Option<std::path::PathBuf> {
    let name_exe = if cfg!(target_os = "windows") && !name.to_lowercase().ends_with(".exe") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    // 用于检测 npm 全局 bin 目录的关键词
    fn is_npm_bin_dir(dir: &std::path::Path) -> bool {
        let s = dir.to_string_lossy().to_lowercase();
        s.ends_with("node_global")
            || s.ends_with("\\npm")
            || s.ends_with("/npm")
            || s.contains("node_modules\\.bin")
            || s.contains("node_modules/.bin")
    }

    // 扫描 PATH 中的 npm 相关目录
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            if !is_npm_bin_dir(&dir) {
                continue;
            }
            // npm 包可执行文件通常位于 {prefix}/node_modules/{package}/bin/{name}.exe
            let candidate = dir
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join(&name_exe);
            if candidate.exists() {
                log::info!("Found opencode in npm global dir: {:?}", candidate);
                return Some(candidate);
            }
        }
    }

    // Windows: 检查默认的 AppData npm 位置
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let appdata_path = std::path::Path::new(&appdata);
            let candidate = appdata_path
                .join("npm")
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join(&name_exe);
            if candidate.exists() {
                log::info!("Found opencode in AppData npm dir: {:?}", candidate);
                return Some(candidate);
            }
        }
        // 也检查 LOCALAPPDATA
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            let candidate = std::path::Path::new(&localappdata)
                .join("npm")
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join(&name_exe);
            if candidate.exists() {
                log::info!("Found opencode in LocalAppData npm dir: {:?}", candidate);
                return Some(candidate);
            }
        }
    }

    None
}

/// 启动 opencode serve 进程
///
/// 先在 PATH 中搜索 binary_path；如果找不到且 binary_path 是裸名字，
/// 会自动在以下位置查找：
/// 1. 应用可执行文件所在目录
/// 2. npm 全局安装目录（node_global、%APPDATA%/npm 等）
fn spawn_opencode_serve(
    binary_path: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Result<std::process::Child, String> {
    log::info!("Starting opencode serve with binary: {}", binary_path);
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    // 先尝试直接启动（会在 PATH 中搜索裸名字）
    match build_opencode_command(binary_path, env_vars).spawn() {
        Ok(child) => return Ok(child),
        Err(_) => {
            let is_bare_name = !binary_path.contains('/') && !binary_path.contains('\\');
            if !is_bare_name {
                return Err(format!(
                    "Failed to start '{}': not found. Check that the path is correct.",
                    binary_path
                ));
            }

            // 裸名字 → 尝试回退查找
            let mut tried: Vec<String> = Vec::new();

            // 1) 应用自身所在目录
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let alt = exe_dir.join(binary_path);
                    tried.push(format!("app dir ({})", alt.display()));
                    if alt.exists() {
                        log::info!("Falling back to app-relative path: {:?}", alt);
                        return try_exec(&alt, binary_path, env_vars);
                    }
                }
            }

            // 2) npm 全局安装目录
            if let Some(found) = search_npm_global_binary(binary_path) {
                tried.push(format!("npm global ({})", found.display()));
                return try_exec(&found, binary_path, env_vars);
            }

            // 所有尝试都失败
            Err(format!(
                "Failed to start '{}': not found in PATH, app directory, or npm global directories.\n\
                 Tried: {}.\n\
                 Please install opencode or set the correct binary path in Settings.",
                binary_path,
                if tried.is_empty() {
                    "no fallback locations".into()
                } else {
                    tried.join("; ")
                }
            ))
        }
    }
}

/// 尝试执行 resolved 路径的二进制文件，失败时返回带上下文的错误
fn try_exec(
    resolved: &std::path::Path,
    _original_name: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Result<std::process::Child, String> {
    let path_str = resolved.to_string_lossy().to_string();
    build_opencode_command(&path_str, env_vars)
        .spawn()
        .map_err(|e| {
            format!(
                "Found opencode at '{}' but failed to execute: {}. \
                 The file may be corrupted or have permission issues.",
                resolved.display(),
                e
            )
        })
}

/// 跨平台杀进程
pub fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// 检查 opencode 服务是否在运行
#[tauri::command]
pub async fn check_opencode_service(url: String) -> Result<bool, String> {
    Ok(is_service_running(&url).await)
}

/// 启动 opencode serve
#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
) -> Result<bool, String> {
    if is_service_running(&url).await {
        log::info!("opencode service already running at {}", url);
        return Ok(false);
    }

    let child = spawn_opencode_serve(&binary_path, &env_vars)?;
    let pid = child.id();
    log::info!("Started opencode serve, PID: {}", pid);

    state.child_pid.store(pid, Ordering::SeqCst);
    state.we_started.store(true, Ordering::SeqCst);

    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_service_running(&url).await {
            log::info!("opencode service is ready at {}", url);
            return Ok(true);
        }
    }

    log::warn!("opencode service started but health check not passing yet");
    Ok(true)
}

/// 停止 opencode serve
#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    let pid = state.child_pid.swap(0, Ordering::SeqCst);
    state.we_started.store(false, Ordering::SeqCst);

    if pid > 0 {
        log::info!("Stopping opencode serve, PID: {}", pid);
        kill_process_by_pid(pid);
    }

    Ok(())
}

/// 查询是否由我们启动了 opencode 服务
#[tauri::command]
pub async fn get_service_started_by_us(state: State<'_, ServiceState>) -> Result<bool, String> {
    Ok(state.we_started.load(Ordering::SeqCst))
}

/// 确认关闭应用（前端调用，可选择是否同时停止服务）
#[tauri::command]
pub async fn confirm_close_app(
    window: tauri::Window,
    state: State<'_, ServiceState>,
    stop_service: bool,
) -> Result<(), String> {
    if stop_service {
        let pid = state.child_pid.swap(0, Ordering::SeqCst);
        if pid > 0 {
            log::info!("Closing app and stopping opencode serve, PID: {}", pid);
            kill_process_by_pid(pid);
        }
        state.we_started.store(false, Ordering::SeqCst);
    } else {
        log::info!("Closing app, keeping opencode serve running");
    }

    window.destroy().map_err(|e| e.to_string())
}
