use super::*;
use crate::book::tests::build;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const FULL: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>Asterix und Kleopatra</Title>
  <Series>Asterix</Series>
  <Number>2</Number>
  <Volume>1968</Volume>
  <Year>1968</Year>
  <Writer>René Goscinny</Writer>
  <Publisher>Ehapa</Publisher>
  <PageCount>48</PageCount>
  <Manga>No</Manga>
  <Summary>nicht gebraucht</Summary>
</ComicInfo>"#;

fn entry(name: &str, size: u64) -> Entry {
    Entry {
        name: name.into(),
        size,
        pos: 0,
        encrypted: false,
    }
}

#[test]
fn all_fields() {
    let m = parse(FULL.as_bytes());
    assert_eq!(
        m,
        BookMeta {
            series: Some("Asterix".into()),
            number: Some("2".into()),
            volume: Some(1968),
            title: Some("Asterix und Kleopatra".into()),
            year: Some(1968),
            writer: Some("René Goscinny".into()),
            publisher: Some("Ehapa".into()),
            page_count: Some(48),
            manga: Some(Manga::No),
        }
    );
}

#[test]
fn missing_and_empty_fields() {
    let m = parse(b"<ComicInfo><Series>  </Series><Number/><Title>T</Title></ComicInfo>");
    assert_eq!(
        m,
        BookMeta {
            title: Some("T".into()),
            ..Default::default()
        }
    );
    assert_eq!(parse(b"<ComicInfo/>"), BookMeta::default());
    assert_eq!(parse(b""), BookMeta::default());
}

#[test]
fn names_without_case_and_first_value_wins() {
    let m = parse(b"<comicinfo><SERIES>Saga</SERIES><series>Other</series><number>12a</number></comicinfo>");
    assert_eq!(m.series.as_deref(), Some("Saga"));
    assert_eq!(m.number.as_deref(), Some("12a"));
}

#[test]
fn entities_cdata_comments_and_white_space() {
    let m = parse(
        "<ComicInfo><!-- c --><Series>Tom &amp; Jerry &#228;&#x1F9B8; &unknown;</Series>\
         <Title><![CDATA[<Ein> Titel]]>\n\t  zwei</Title><Writer>a\u{7}b</Writer></ComicInfo>"
            .as_bytes(),
    );
    assert_eq!(m.series.as_deref(), Some("Tom & Jerry ä🦸"));
    assert_eq!(m.title.as_deref(), Some("<Ein> Titel zwei"));
    assert_eq!(m.writer.as_deref(), Some("a b"));
}

#[test]
fn nested_elements_inside_a_field_are_ignored() {
    let m = parse(b"<ComicInfo><Series>A<b>x</b>B</Series><Pages><Page Image=\"0\"/></Pages></ComicInfo>");
    assert_eq!(m.series.as_deref(), Some("AB"));
}

#[test]
fn encodings() {
    let text = "<ComicInfo><Series>Hägar</Series></ComicInfo>";
    let hagar = Some("Hägar".to_string());
    // UTF-8 with BOM
    let mut b = vec![0xEF, 0xBB, 0xBF];
    b.extend_from_slice(text.as_bytes());
    assert_eq!(parse(&b).series, hagar);
    // UTF-16 LE / BE with BOM, LE without
    let le: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let be: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
    assert_eq!(parse(&[&[0xFF, 0xFE][..], &le].concat()).series, hagar);
    assert_eq!(parse(&[&[0xFE, 0xFF][..], &be].concat()).series, hagar);
    assert_eq!(parse(&le).series, hagar);
    // Latin-1 declaration
    let mut l = b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><ComicInfo><Series>H".to_vec();
    l.push(0xE4);
    l.extend_from_slice(b"gar</Series></ComicInfo>");
    assert_eq!(parse(&l).series, hagar);
    // invalid UTF-8 without declaration: replacement character, no crash
    let mut bad = b"<ComicInfo><Series>H".to_vec();
    bad.push(0xE4);
    bad.extend_from_slice(b"gar</Series></ComicInfo>");
    assert_eq!(parse(&bad).series.as_deref(), Some("H\u{FFFD}gar"));
}

#[test]
fn invalid_xml_gives_no_fields() {
    for bad in [
        &b"<ComicInfo><Series>A</Series>"[..],                // not closed
        b"<ComicInfo><Series>A</Title></ComicInfo>",          // wrong end
        b"<Other><Series>A</Series></Other>",                 // other root
        b"<ComicInfo><Series>A</Series></ComicInfo><ComicInfo/>", // two roots
        b"\x00\x01\x02 garbage",
        b"<ComicInfo><Series>A</Series></ComicInfo></x>",
    ] {
        assert_eq!(parse(bad), BookMeta::default(), "{}", String::from_utf8_lossy(bad));
    }
}

#[test]
fn doctype_entities_are_never_expanded() {
    // "billion laughs": the parser never expands DTD entities, so it is fast and the
    // reference stays unknown (dropped)
    let mut x = String::from("<?xml version=\"1.0\"?><!DOCTYPE ComicInfo [<!ENTITY a \"aaaaaaaaaa\">");
    for i in 1..10 {
        x.push_str(&format!("<!ENTITY a{i} \"{}\">", format!("&a{};", i - 1).repeat(10)));
    }
    x.push_str("]><ComicInfo><Series>X&a9;Y</Series></ComicInfo>");
    let t = Instant::now();
    let m = parse(x.as_bytes());
    assert!(t.elapsed() < Duration::from_secs(1));
    assert_eq!(m.series.as_deref(), Some("XY"));
}

#[test]
fn too_deep_or_too_large() {
    let deep = format!(
        "<ComicInfo>{}{}</ComicInfo>",
        "<a>".repeat(10_000),
        "</a>".repeat(10_000)
    );
    assert_eq!(parse(deep.as_bytes()), BookMeta::default());
    let mut big = b"<ComicInfo><Series>A</Series><Summary>".to_vec();
    big.extend(std::iter::repeat_n(b'x', MAX_XML as usize));
    big.extend_from_slice(b"</Summary></ComicInfo>");
    assert_eq!(parse(&big), BookMeta::default());
}

#[test]
fn numbers_out_of_range_are_dropped() {
    let m = parse(
        b"<ComicInfo><Year>99</Year><Volume>-1</Volume><PageCount>0</PageCount>\
          <Number>12345678901234567890</Number></ComicInfo>",
    );
    assert_eq!(m.year, None);
    assert_eq!(m.volume, None);
    assert_eq!(m.page_count, None);
    assert_eq!(m.number.as_deref(), Some("1234567890123456")); // cut to 16 characters
    let m = parse(b"<ComicInfo><Year> 2015 </Year><Volume>2</Volume><PageCount>100000</PageCount></ComicInfo>");
    assert_eq!((m.year, m.volume, m.page_count), (Some(2015), Some(2), Some(100_000)));
    assert_eq!(parse(b"<ComicInfo><Year>abc</Year></ComicInfo>").year, None);
}

#[test]
fn long_texts_are_cut_by_characters() {
    let long = "🦸".repeat(500);
    let m = parse(format!("<ComicInfo><Series>{long}</Series></ComicInfo>").as_bytes());
    assert_eq!(m.series.unwrap().chars().count(), MAX_TEXT);
}

#[test]
fn manga_values() {
    let manga = |v: &str| parse(format!("<ComicInfo><Manga>{v}</Manga></ComicInfo>").as_bytes()).manga;
    assert_eq!(manga("Yes"), Some(Manga::Yes));
    assert_eq!(manga("YesAndRightToLeft"), Some(Manga::Rtl));
    assert_eq!(manga("no"), Some(Manga::No));
    assert_eq!(manga("Unknown"), None);
}

#[test]
fn serialises_without_empty_fields() {
    let json = serde_json::to_string(&BookMeta {
        series: Some("S".into()),
        page_count: Some(3),
        manga: Some(Manga::Rtl),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(json, r#"{"series":"S","pageCount":3,"manga":"rtl"}"#);
    assert_eq!(serde_json::to_string(&BookMeta::default()).unwrap(), "{}");
    let back: BookMeta = serde_json::from_str(r#"{"series":"S","extra":1}"#).unwrap();
    assert_eq!(back.series.as_deref(), Some("S"));
}

#[test]
fn finds_the_right_entry() {
    let e = [
        entry("__MACOSX/ComicInfo.xml", 10),
        entry("._ComicInfo.xml", 10),
        entry("sub/ComicInfo.xml", 10),
        entry("comicinfo.XML", 10),
        entry("page01.jpg", 10),
    ];
    assert_eq!(find(&e).unwrap().name, "comicinfo.XML");
    assert_eq!(find(&e[..3]).unwrap().name, "sub/ComicInfo.xml");
    assert!(find(&e[..2]).is_none());
    assert!(find(&[entry("ComicInfo.xml.bak", 1)]).is_none());
}

fn page() -> Vec<u8> {
    build::jpeg(8, 12, 1)
}

const INFO: &[u8] = b"<ComicInfo><Series>Asterix</Series><Number>3</Number></ComicInfo>";

fn asterix() -> BookMeta {
    BookMeta {
        series: Some("Asterix".into()),
        number: Some("3".into()),
        ..Default::default()
    }
}

#[test]
fn reads_it_from_every_container() {
    let d = tempfile::tempdir().unwrap();
    let entries = vec![("p01.jpg", page()), ("ComicInfo.xml", INFO.to_vec())];
    let z = d.path().join("Ganz anderer Name ä 🦸.cbz");
    build::cbz(&z, &entries);
    assert_eq!(read_book(&z, None).unwrap(), asterix());
    // a CBR that is a ZIP
    let zr = d.path().join("zip.cbr");
    build::cbz(&zr, &entries);
    assert_eq!(read_book(&zr, None).unwrap(), asterix());
    let t = d.path().join("b.cbt");
    build::cbt(&t, &entries);
    assert_eq!(read_book(&t, None).unwrap(), asterix());
    for solid in [false, true] {
        let s = d.path().join(format!("b{solid}.cb7"));
        build::cb7(&s, &entries, solid);
        assert_eq!(read_book(&s, None).unwrap(), asterix());
    }
    let r = d.path().join("b.cbr");
    build::cbr4(&r, &entries);
    assert_eq!(read_book(&r, None).unwrap(), asterix());
}

#[test]
fn without_comicinfo_or_too_large_it_is_empty() {
    let d = tempfile::tempdir().unwrap();
    let z = d.path().join("a.cbz");
    build::cbz(&z, &[("p01.jpg", page())]);
    assert_eq!(read_book(&z, None).unwrap(), BookMeta::default());
    let big = d.path().join("big.cbz");
    let mut xml = b"<ComicInfo><Series>A</Series><Summary>".to_vec();
    xml.extend(std::iter::repeat_n(b'x', MAX_XML as usize + 10));
    xml.extend_from_slice(b"</Summary></ComicInfo>");
    build::cbz(&big, &[("p01.jpg", page()), ("ComicInfo.xml", xml)]);
    assert_eq!(read_book(&big, None).unwrap(), BookMeta::default());
}

#[test]
fn pdf_is_empty_without_parsing() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("a.pdf");
    std::fs::write(&p, b"%PDF-1.7\n garbage that is no PDF").unwrap();
    assert_eq!(outcome(&p, None), Some(BookMeta::default()));
}

fn testdata(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("testdata/archives")
        .join(name)
}

#[test]
fn outcomes_of_failures() {
    let d = tempfile::tempdir().unwrap();
    // broken and encrypted: lasting → read, empty
    let broken = d.path().join("broken.cbz");
    std::fs::write(&broken, b"PK\x03\x04 broken").unwrap();
    assert_eq!(outcome(&broken, None), Some(BookMeta::default()));
    assert_eq!(outcome(&testdata("zip-aes.zip"), None), Some(BookMeta::default()));
    // not a book at all (unknown magic): lasting
    let text = d.path().join("text.cbz");
    std::fs::write(&text, b"just text").unwrap();
    assert_eq!(outcome(&text, None), Some(BookMeta::default()));
    // vanished: try again next time
    assert_eq!(outcome(&d.path().join("gone.cbz"), None), None);
    // cancelled: try again next time
    let z = d.path().join("a.cbz");
    build::cbz(&z, &[("p01.jpg", page()), ("ComicInfo.xml", INFO.to_vec())]);
    let cancel = AtomicBool::new(true);
    assert_eq!(outcome(&z, Some(&cancel)), None);
}
