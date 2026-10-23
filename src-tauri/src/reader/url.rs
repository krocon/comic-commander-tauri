//! URLs of the `ccpage` scheme (design 005 E7): `/<token>.<page>.<width>` – a token of an open
//! book, never a path. Strict: anything else is `None` (404).

pub const SCHEME: &str = "ccpage";
/// Target widths in device pixels (E2); 0 = the original.
pub const WIDTHS: [u32; 6] = [1024, 1600, 2048, 2560, 3200, 4096];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRequest {
    pub token: String,
    pub index: usize,
    pub width: u32,
}

fn is_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn digits(s: &str, max_len: usize) -> Option<u64> {
    (!s.is_empty() && s.len() <= max_len && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}

pub fn parse_path(path: &str) -> Option<PageRequest> {
    let p = path.strip_prefix('/').unwrap_or(path);
    let mut parts = p.split('.');
    let (token, index, width) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || token.len() != 16 || !is_hex(token) {
        return None;
    }
    let index = digits(index, 6)? as usize;
    let width = digits(width, 4)? as u32;
    (width == 0 || WIDTHS.contains(&width)).then(|| PageRequest {
        token: token.to_owned(),
        index,
        width,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_well_formed_paths() {
        assert_eq!(
            parse_path("/0123456789abcdef.12.2048"),
            Some(PageRequest {
                token: "0123456789abcdef".into(),
                index: 12,
                width: 2048
            })
        );
        assert_eq!(parse_path("/0123456789abcdef.0.0").unwrap().width, 0);
        for bad in [
            "",
            "/",
            "/0123456789abcdef.1",
            "/0123456789abcdef.1.2048.1",
            "/0123456789ABCDEF.1.2048",
            "/0123456789abcde.1.2048",
            "/0123456789abcdef.-1.2048",
            "/0123456789abcdef.+1.2048",
            "/0123456789abcdef.1.2000",
            "/0123456789abcdef.1234567.0",
            "/0123456789abcdef.1.",
            "/../../etc/passwd.1.0",
            "/0123456789abcdef%2F.1.0",
        ] {
            assert_eq!(parse_path(bad), None, "{bad}");
        }
    }
}
