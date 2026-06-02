// ============================================
// Tauri Application Entry Point
// Unified Bridge + Plugin Registration + Service Management
// ============================================
mod bridge;
mod commands;
#[cfg(not(target_os = "android"))]
mod dir_state;
mod service;

use bridge::BridgeState;
use tauri::Manager;

#[cfg(windows)]
use tauri_plugin_decorum::WebviewWindowExt;

// Desktop-only imports for service management
#[cfg(not(target_os = "android"))]
use dir_state::OpenDirectoryState;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

/// 从命令行参数中提取目录路径
#[cfg(not(target_os = "android"))]
fn extract_directory_from_args(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        if std::path::Path::new(arg).is_dir() {
            return Some(arg.clone());
        }
    }
    None
}

#[cfg(not(target_os = "android"))]
fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("main window config missing");

    configure_desktop_window_builder(tauri::WebviewWindowBuilder::from_config(app, &config)?)
        .visible(false)
        .build()
}

#[cfg(target_os = "android")]
fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("main window config missing");

    tauri::WebviewWindowBuilder::from_config(app, &config)?.build()
}

#[cfg(not(target_os = "android"))]
fn finish_desktop_window_setup(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    let _ = window.create_overlay_titlebar();
}

#[cfg(not(target_os = "android"))]
pub(crate) fn mark_window_ready<R: tauri::Runtime>(
    window: &tauri::Window<R>,
) -> Result<(), tauri::Error> {
    window.show()?;
    let _ = window.set_focus();

    Ok(())
}

#[cfg(not(target_os = "android"))]
fn configure_desktop_window_builder<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    window_builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder;

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 16.0));

    window_builder
}

/// 把目录路径传递给 main 窗口（通过 pending state + emit 事件）
#[cfg(not(target_os = "android"))]
fn deliver_directory_to_main(app: &tauri::AppHandle, dir: String) {
    if let Some(state) = app.try_state::<OpenDirectoryState>() {
        let pending = state.pending().pin();
        // 如果 main 还没取走旧的 pending 目录，就覆盖它（最近一次右键生效）
        pending.insert("main".to_string(), Arc::from(dir.clone()));
    }
    let _ = app.emit("open-directory", dir);
}

/// Windows: 注册右键菜单到 HKEY_CURRENT_USER
#[cfg(windows)]
fn register_context_menu(exe_path: &str) {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let escaped_path = format!("\"{}\"", exe_path);

    // Directory\shell + Directory\Background\shell
    let reg_script = format!(
        r#"
[HKEY_CURRENT_USER\Software\Classes\Directory\shell\OpenCode]
@="用 OpenCode 打开"
"Icon"="{0},0"

[HKEY_CURRENT_USER\Software\Classes\Directory\shell\OpenCode\command]
@="{0} \"%1\""

[HKEY_CURRENT_USER\Software\Classes\Directory\Background\shell\OpenCode]
@="用 OpenCode 打开"
"Icon"="{0},0"

[HKEY_CURRENT_USER\Software\Classes\Directory\Background\shell\OpenCode\command]
@="{0} \"%V\""
"#,
        escaped_path
    );

    let temp_dir = std::env::temp_dir();
    let reg_file = temp_dir.join("opencode_context_menu.reg");

    if let Err(e) = std::fs::write(&reg_file, reg_script.as_bytes()) {
        log::error!("Failed to write registry script: {}", e);
        return;
    }

    let result = Command::new("regedit.exe")
        .args(["/s", reg_file.to_string_lossy().as_ref()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();

    match result {
        Ok(_) => log::info!("Context menu registered successfully"),
        Err(e) => log::error!("Failed to register context menu: {}", e),
    }
}

#[cfg(windows)]
fn get_current_exe_path() -> Option<String> {
    std::env::current_exe()
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

pub fn run() {
    let builder = tauri::Builder::default().manage(BridgeState::default());

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_decorum::init());

    // Desktop: 注册 OpenDirectoryState + single-instance 插件（需在 setup 之前）
    #[cfg(not(target_os = "android"))]
    let builder =
        builder
            .manage(OpenDirectoryState::default())
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                let dir = extract_directory_from_args(&args);
                log::info!("Single-instance: directory from new launch: {:?}", dir);
                if let Some(dir) = dir {
                    // 单窗口模式：将目录传递给已有 main 窗口
                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.set_focus();
                        let _ = main_window.show();
                    }
                    deliver_directory_to_main(app, dir);
                }
            }));

    let builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 始终启用 log 插件，方便排查问题
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            #[cfg(not(target_os = "android"))]
            {
                let main_window = create_main_window(&app.handle())?;
                finish_desktop_window_setup(&main_window);

                #[cfg(debug_assertions)]
                main_window.open_devtools();
            }

            #[cfg(target_os = "android")]
            {
                let _main_window = create_main_window(&app.handle())?;
            }

            // Desktop: 解析 CLI 参数，存入 pending state
            #[cfg(not(target_os = "android"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(dir) = extract_directory_from_args(&args) {
                    log::info!("CLI directory argument: {}", dir);
                    deliver_directory_to_main(app.handle(), dir);
                }
            }

            // Windows: 注册右键菜单
            #[cfg(windows)]
            {
                if let Some(exe_path) = get_current_exe_path() {
                    register_context_menu(&exe_path);
                }
            }

            Ok(())
        });

    // Desktop: 注册 service management commands + 窗口关闭拦截
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(service::ServiceState::default())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // 单窗口模式：关闭即最后一个窗口
                    let state = window.state::<service::ServiceState>();
                    if state.we_started.load(std::sync::atomic::Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.emit("close-requested", ());
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    let state = window.state::<BridgeState>();
                    state.disconnect_window(window.label());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_connect,
            commands::bridge::bridge_send,
            commands::bridge::bridge_disconnect,
            commands::utils::get_cli_directory,
            commands::utils::desktop_window_ready,
            commands::opencode::check_opencode_service,
            commands::opencode::start_opencode_service,
            commands::opencode::stop_opencode_service,
            commands::opencode::get_service_started_by_us,
            commands::opencode::confirm_close_app,
        ]);

    // Android: 注册 bridge commands
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::bridge::bridge_connect,
        commands::bridge::bridge_send,
        commands::bridge::bridge_disconnect,
    ]);

    // build + run 分开调用，以支持 macOS RunEvent::Opened
    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|err| panic!("error while building tauri application: {err}"));

    app.run(|_app_handle, _event| {
        // macOS: 处理 Finder "Open with" / 拖文件夹到 Dock 图标
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if path.is_dir() {
                        let dir = path.to_string_lossy().to_string();
                        log::info!("macOS Opened directory: {}", dir);
                        deliver_directory_to_main(_app_handle, dir);
                    }
                }
            }
        }
    });
}
