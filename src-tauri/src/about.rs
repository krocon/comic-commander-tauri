//! Data for the About dialog. The version comes from `tauri.conf.json`, which points at
//! `package.json` (one source of truth).

use crate::model::AppInfo;

pub fn app_info(name: &str, version: &str) -> AppInfo {
    AppInfo {
        name: name.to_owned(),
        version: version.to_owned(),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_platform() {
        let info = app_info("Comic Commander", "0.1.0");
        assert_eq!(info.version, "0.1.0");
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
    }
}
