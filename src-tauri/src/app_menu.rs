//! The native menu bar of macOS (design 008 E8): the frontend builds one menu model
//! (`features/menus/menu-model.ts`) and sends it here as a [`MenuSpec`]; Rust checks it strictly
//! (sizes, ids, texts), turns the shortcuts into accelerators (only chords with a modifier or an
//! F key – a plain key in a menu would be caught before the WebView) and builds the menu with
//! the App, Edit (copy/paste in text fields!) and Window menus of the platform around it.
//! A click sends the event [`EVENT`] with the action id. Windows/Linux use an HTML menu bar –
//! there the spec is only checked.

use crate::error::{FsError, FsErrorCode};
use serde::{Deserialize, Serialize};

pub const EVENT: &str = "menu-action";
pub const MAX_MENUS: usize = 12;
pub const MAX_ITEMS: usize = 400;
pub const MAX_DEPTH: usize = 3;
pub const MAX_LABEL: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuItemSpec {
    Action {
        id: String,
        label: String,
        #[serde(default)]
        accelerator: Option<String>,
        #[serde(default = "yes")]
        enabled: bool,
        #[serde(default)]
        checked: Option<bool>,
    },
    Separator,
    Submenu {
        label: String,
        items: Vec<MenuItemSpec>,
    },
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TopMenu {
    pub label: String,
    pub items: Vec<MenuItemSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MenuSpec {
    pub menus: Vec<TopMenu>,
}

/// Payload of [`EVENT`].
#[derive(Debug, Clone, Serialize)]
pub struct MenuAction {
    pub id: String,
}

fn invalid(message: impl Into<String>) -> FsError {
    FsError::new(FsErrorCode::InvalidMenu, message, None)
}

/// An action id: `^[a-z][A-Za-z0-9.]{0,63}$`.
pub fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '.')
}

fn valid_label(label: &str) -> bool {
    !label.trim().is_empty()
        && label.chars().count() <= MAX_LABEL
        && !label.chars().any(char::is_control)
}

/// Checks the whole spec; the first problem is the error.
pub fn validate(spec: &MenuSpec) -> Result<(), FsError> {
    if spec.menus.len() > MAX_MENUS {
        return Err(invalid("too many menus"));
    }
    let mut count = 0usize;
    fn walk(items: &[MenuItemSpec], depth: usize, count: &mut usize) -> Result<(), FsError> {
        if depth > MAX_DEPTH {
            return Err(invalid("menus nested too deeply"));
        }
        for item in items {
            *count += 1;
            if *count > MAX_ITEMS {
                return Err(invalid("too many menu items"));
            }
            match item {
                MenuItemSpec::Action { id, label, .. } => {
                    if !valid_id(id) {
                        return Err(invalid(format!("bad action id {id:?}")));
                    }
                    if !valid_label(label) {
                        return Err(invalid("bad menu text"));
                    }
                }
                MenuItemSpec::Separator => {}
                MenuItemSpec::Submenu { label, items } => {
                    if !valid_label(label) {
                        return Err(invalid("bad menu text"));
                    }
                    walk(items, depth + 1, count)?;
                }
            }
        }
        Ok(())
    }
    for m in &spec.menus {
        if !valid_label(&m.label) {
            return Err(invalid("bad menu text"));
        }
        walk(&m.items, 1, &mut count)?;
    }
    Ok(())
}

/// Our chord notation (`Mod+Shift+P`, design 008 E6) as a Tauri accelerator, `None` when the
/// chord has no modifier and is no F key, or uses a key the menu cannot show.
pub fn accelerator(chord: &str) -> Option<String> {
    let (mods, key) = split_chord(chord)?;
    let mut out: Vec<String> = Vec::new();
    for m in &mods {
        out.push(
            match *m {
                "Mod" => "CmdOrCtrl",
                "Ctrl" => "Control",
                "Alt" => "Alt",
                "Shift" => "Shift",
                _ => return None,
            }
            .into(),
        );
    }
    let is_f = key.len() <= 3
        && key.starts_with('F')
        && key[1..].parse::<u8>().is_ok_and(|n| (1..=24).contains(&n));
    if mods.is_empty() && !is_f {
        return None;
    }
    let k = if key.chars().count() == 1 {
        let c = key.chars().next()?;
        if c.is_ascii_alphanumeric() {
            c.to_ascii_uppercase().to_string()
        } else {
            match c {
                ',' | '.' | '-' | '=' | '[' | ']' | '/' | ';' | '\'' | '`' | '\\' => c.to_string(),
                _ => return None,
            }
        }
    } else if is_f
        || matches!(
            key,
            "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
                | "Enter"
                | "Escape"
                | "Space"
                | "Tab"
                | "Backspace"
                | "Delete"
        )
    {
        key.to_string()
    } else {
        return None;
    };
    out.push(k);
    Some(out.join("+"))
}

/// `Mod+Shift+P` → (["Mod", "Shift"], "P"); `Mod++` → (["Mod"], "+").
pub fn split_chord(chord: &str) -> Option<(Vec<&str>, &str)> {
    if chord.is_empty() || chord.len() > 40 || chord.chars().any(char::is_control) {
        return None;
    }
    let (head, key) = if let Some(h) = chord.strip_suffix("++") {
        (h, "+")
    } else if chord == "+" {
        ("", "+")
    } else {
        match chord.rsplit_once('+') {
            Some((h, k)) => (h, k),
            None => ("", chord),
        }
    };
    if key.is_empty() {
        return None;
    }
    let mods: Vec<&str> = if head.is_empty() {
        Vec::new()
    } else {
        head.split('+').collect()
    };
    let order = ["Mod", "Ctrl", "Alt", "Shift", "Meta"];
    let mut last = None;
    for m in &mods {
        let i = order.iter().position(|o| o == m)?;
        if last.is_some_and(|l| i <= l) {
            return None;
        }
        last = Some(i);
    }
    Some((mods, key))
}

/// Builds and sets the native menu (macOS). Compiled on every OS, so that a Linux build checks it
/// too (called on macOS only).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn apply(app: &tauri::AppHandle, spec: &MenuSpec) -> tauri::Result<()> {
    use tauri::menu::{
        CheckMenuItemBuilder, IsMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
        Submenu, SubmenuBuilder,
    };
    fn items<'m>(
        app: &'m tauri::AppHandle,
        list: &[MenuItemSpec],
        b: SubmenuBuilder<'m, tauri::Wry, tauri::AppHandle>,
    ) -> tauri::Result<SubmenuBuilder<'m, tauri::Wry, tauri::AppHandle>> {
        let mut b = b;
        for item in list {
            b = match item {
                MenuItemSpec::Separator => b.separator(),
                MenuItemSpec::Action {
                    id,
                    label,
                    accelerator: acc,
                    enabled,
                    checked,
                } => {
                    let acc = acc.as_deref().and_then(accelerator);
                    match checked {
                        Some(c) => {
                            let mut i = CheckMenuItemBuilder::with_id(id.as_str(), label)
                                .enabled(*enabled)
                                .checked(*c);
                            if let Some(a) = acc {
                                i = i.accelerator(a);
                            }
                            b.item(&i.build(app)?)
                        }
                        None => {
                            let mut i =
                                MenuItemBuilder::with_id(id.as_str(), label).enabled(*enabled);
                            if let Some(a) = acc {
                                i = i.accelerator(a);
                            }
                            b.item(&i.build(app)?)
                        }
                    }
                }
                MenuItemSpec::Submenu { label, items: sub } => {
                    let s: Submenu<tauri::Wry> =
                        items(app, sub, SubmenuBuilder::new(app, label))?.build()?;
                    b.item(&s)
                }
            };
        }
        Ok(b)
    }
    let app_menu = SubmenuBuilder::new(app, app.package_info().name.clone())
        .item(&MenuItemBuilder::with_id("app.about", "About Comic Commander").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("app.settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("app.quit", "Quit Comic Commander")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let mut tops: Vec<Submenu<tauri::Wry>> = Vec::new();
    for m in &spec.menus {
        tops.push(items(app, &m.items, SubmenuBuilder::new(app, &m.label))?.build()?);
    }
    let mut all: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&app_menu];
    // our first menu (File) comes right after the app menu, Edit after it
    let mut rest = tops.iter();
    if let Some(first) = rest.next() {
        all.push(first);
    }
    all.push(&edit);
    for t in rest {
        all.push(t);
    }
    all.push(&window);
    let menu = MenuBuilder::new(app).items(&all).build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(id: &str, acc: Option<&str>) -> MenuItemSpec {
        MenuItemSpec::Action {
            id: id.into(),
            label: "Lesen ä".into(),
            accelerator: acc.map(Into::into),
            enabled: true,
            checked: None,
        }
    }

    #[test]
    fn accelerators_only_for_chords_with_modifiers_or_f_keys() {
        assert_eq!(
            accelerator("Mod+Shift+p").as_deref(),
            Some("CmdOrCtrl+Shift+P")
        );
        assert_eq!(accelerator("Mod+1").as_deref(), Some("CmdOrCtrl+1"));
        assert_eq!(
            accelerator("Mod+Ctrl+f").as_deref(),
            Some("CmdOrCtrl+Control+F")
        );
        assert_eq!(accelerator("Mod+,").as_deref(), Some("CmdOrCtrl+,"));
        assert_eq!(accelerator("Mod+=").as_deref(), Some("CmdOrCtrl+="));
        assert_eq!(accelerator("F11").as_deref(), Some("F11"));
        assert_eq!(
            accelerator("Mod+ArrowUp").as_deref(),
            Some("CmdOrCtrl+ArrowUp")
        );
        // plain keys would be caught by the menu before the WebView
        assert_eq!(accelerator("ArrowRight"), None);
        assert_eq!(accelerator("Space"), None);
        assert_eq!(accelerator("s"), None);
        // what the menu cannot show
        assert_eq!(accelerator("Mod++"), None);
        assert_eq!(accelerator("Mod+Unidentified"), None);
        assert_eq!(accelerator("Shift+Mod+p"), None);
        assert_eq!(accelerator(""), None);
    }

    #[test]
    fn chords_split_with_a_plus_key() {
        assert_eq!(split_chord("Mod++"), Some((vec!["Mod"], "+")));
        assert_eq!(split_chord("+"), Some((vec![], "+")));
        assert_eq!(
            split_chord("Mod+Shift+F10"),
            Some((vec!["Mod", "Shift"], "F10"))
        );
        assert_eq!(split_chord("Hyper+x"), None);
        assert_eq!(split_chord("Mod+"), None);
        assert_eq!(split_chord("Mod+Mod+x"), None);
    }

    #[test]
    fn spec_is_checked_strictly() {
        let ok = MenuSpec {
            menus: vec![TopMenu {
                label: "Ablage".into(),
                items: vec![
                    action("grid.read", Some("Enter")),
                    MenuItemSpec::Separator,
                    MenuItemSpec::Submenu {
                        label: "Sortierung".into(),
                        items: vec![action("view.sort.path", None)],
                    },
                ],
            }],
        };
        assert!(validate(&ok).is_ok());
        let json = r#"{"menus":[{"label":"File","items":[{"kind":"action","id":"app.quit","label":"Quit","accelerator":"Mod+q"},{"kind":"separator"}]}]}"#;
        assert!(validate(&serde_json::from_str::<MenuSpec>(json).unwrap()).is_ok());
        let bad_id = MenuSpec {
            menus: vec![TopMenu {
                label: "x".into(),
                items: vec![action("../evil", None)],
            }],
        };
        assert_eq!(
            validate(&bad_id).unwrap_err().code,
            FsErrorCode::InvalidMenu
        );
        let mut deep = action("a", None);
        for _ in 0..4 {
            deep = MenuItemSpec::Submenu {
                label: "s".into(),
                items: vec![deep],
            };
        }
        let deep = MenuSpec {
            menus: vec![TopMenu {
                label: "x".into(),
                items: vec![deep],
            }],
        };
        assert!(validate(&deep).is_err());
        let many = MenuSpec {
            menus: vec![TopMenu {
                label: "x".into(),
                items: (0..=MAX_ITEMS).map(|_| MenuItemSpec::Separator).collect(),
            }],
        };
        assert!(validate(&many).is_err());
        let ctrl = MenuSpec {
            menus: vec![TopMenu {
                label: "a\u{0}b".into(),
                items: vec![],
            }],
        };
        assert!(validate(&ctrl).is_err());
        assert!(!valid_id("Grid.read"));
        assert!(valid_id("app.category.1"));
    }
}
