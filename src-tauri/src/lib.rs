use base64::{engine::general_purpose, Engine as _};
use std::fs;

#[tauri::command]
fn export_png(filename: String, data_url: String) -> Result<Option<String>, String> {
  let encoded = data_url
    .strip_prefix("data:image/png;base64,")
    .ok_or_else(|| "Invalid PNG data URL.".to_string())?;
  let bytes = general_purpose::STANDARD
    .decode(encoded)
    .map_err(|error| format!("Could not decode PNG: {error}"))?;
  let safe_name = filename
    .chars()
    .map(|ch| match ch {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
      _ => ch,
    })
    .collect::<String>();
  let safe_name = if safe_name.trim().is_empty() {
    "perfect-pixels-export.png".to_string()
  } else {
    safe_name
  };
  let Some(mut output) = rfd::FileDialog::new()
    .add_filter("PNG image", &["png"])
    .set_file_name(&safe_name)
    .save_file()
  else {
    return Ok(None);
  };
  if output.extension().is_none() {
    output.set_extension("png");
  }
  fs::write(&output, bytes).map_err(|error| format!("Could not write PNG: {error}"))?;
  Ok(Some(output.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![export_png])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
