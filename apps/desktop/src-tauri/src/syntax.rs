use std::sync::{Mutex, OnceLock};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

// Serialize CPU jobs off the UI thread; the frontend cache coalesces identical inputs.
static ENGINE: OnceLock<Result<(HighlightConfiguration, Mutex<Highlighter>), String>> =
    OnceLock::new();

fn tokens(text: &str) -> Result<Vec<u8>, String> {
    let (cfg, highlighter) = ENGINE
        .get_or_init(|| {
            let mut cfg = HighlightConfiguration::new(
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                "typescript",
                &format!(
                    "{}\n{}",
                    tree_sitter_typescript::HIGHLIGHTS_QUERY,
                    tree_sitter_javascript::HIGHLIGHT_QUERY
                ),
                "",
                tree_sitter_typescript::LOCALS_QUERY,
            )
            .map_err(|e| e.to_string())?;
            cfg.configure(&[
                "keyword", "function", "type", "string", "number", "comment", "constant",
            ]);
            Ok((cfg, Mutex::new(Highlighter::new())))
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let mut engine = highlighter.lock().map_err(|e| e.to_string())?;
    let mut styles = Vec::new();
    let mut bytes = Vec::new();
    for event in engine
        .highlight(cfg, text.as_bytes(), None, |_| None)
        .map_err(|e| e.to_string())?
    {
        match event.map_err(|e| e.to_string())? {
            HighlightEvent::HighlightStart(h) => styles.push(h.0 as u8 + 1),
            HighlightEvent::HighlightEnd => {
                styles.pop();
            }
            HighlightEvent::Source { start, end } => {
                let units = text[start..end].encode_utf16().count() as u32;
                bytes.extend_from_slice(&units.to_le_bytes());
                bytes.push(styles.last().copied().unwrap_or_default());
            }
        }
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn pig_highlight_ts(text: String) -> Result<tauri::ipc::Response, String> {
    if text.len() > 400_000 || text.split('\n').take(2001).count() > 2000 {
        return Err("Source too large".into());
    }
    tauri::async_runtime::spawn_blocking(move || tokens(&text))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

#[test]
fn spans_cover_utf16_source() {
    let text = "const 日本 = '🍵';\r\n// done";
    let spans = tokens(text).unwrap();
    assert!(spans.chunks_exact(5).any(|s| s[4] != 0));
    assert_eq!(
        spans
            .chunks_exact(5)
            .map(|s| u32::from_le_bytes(s[..4].try_into().unwrap()))
            .sum::<u32>(),
        text.encode_utf16().count() as u32
    );
}
