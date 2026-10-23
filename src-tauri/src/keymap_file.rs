//! The user's shortcut overrides (design 008 E2): `<app config>/keymap.json`
//! `{ "version": 1, "bindings": { "<action id>": ["Mod+Shift+X", …] } }`. Loaded with the shared
//! config loader (missing → none, broken → kept as `.bad` + warning); every entry is checked –
//! bad ids and chords that are no text (empty, > 40 bytes, control characters) are dropped.
//! Unknown action ids and the chord syntax (`Cmd`, `Control`, any order) are the frontend's
//! business – it knows the catalog and normalises (review 008 #9: one parser, not two). Written only by hand (an editor follows with prompt 009).

use crate::app_menu::valid_id;
use crate::config_file::{ConfigWarning, read_config};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const FILE_NAME: &str = "keymap.json";
const MAX_FILE: u64 = 64 << 10;
const MAX_ACTIONS: usize = 500;
const MAX_CHORDS: usize = 8;

#[derive(Debug, Clone, Default, Deserialize)]
struct File {
    #[serde(default)]
    bindings: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeymapOverrides {
    pub bindings: BTreeMap<String, Vec<String>>,
    pub warning: Option<ConfigWarning>,
}

/// A chord is plain text of reasonable length; its syntax is checked by `normalizeChord` (TS).
fn chord_text(c: &str) -> bool {
    !c.is_empty() && c.len() <= 40 && !c.chars().any(char::is_control)
}

pub fn load(config_dir: &Path) -> KeymapOverrides {
    let loaded = read_config(
        &config_dir.join(FILE_NAME),
        MAX_FILE,
        File::default,
        |text| serde_json::from_str::<File>(text).map_err(|e| e.to_string()),
    );
    let bindings = loaded
        .value
        .bindings
        .into_iter()
        .filter(|(id, _)| valid_id(id))
        .take(MAX_ACTIONS)
        .map(|(id, chords)| {
            let chords: Vec<String> = chords
                .into_iter()
                .filter(|c| chord_text(c))
                .take(MAX_CHORDS)
                .collect();
            (id, chords)
        })
        .collect();
    KeymapOverrides {
        bindings,
        warning: loaded.warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_no_override() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(load(d.path()), KeymapOverrides::default());
    }

    #[test]
    fn entries_are_checked() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join(FILE_NAME),
            r#"{"version":1,"bindings":{"reader.next":["j","Mod++","Shift+Cmd+p","","a\nb"],"../x":["a"],"app.palette":[]}}"#,
        )
        .unwrap();
        let o = load(d.path());
        assert_eq!(o.bindings.len(), 2);
        // the frontend normalises `Shift+Cmd+p`; only what is no chord text goes here
        assert_eq!(o.bindings["reader.next"], ["j", "Mod++", "Shift+Cmd+p"]);
        assert!(o.bindings["app.palette"].is_empty());
        assert!(o.warning.is_none());
    }

    #[test]
    fn broken_file_gives_a_warning() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(FILE_NAME), b"{ nope").unwrap();
        let o = load(d.path());
        assert!(o.bindings.is_empty());
        assert_eq!(o.warning.unwrap().code, "broken");
    }
}
