use family_core::Engine;
use serde_json::{json, Value};
use tempfile::TempDir;
fn engine() -> (TempDir, Engine) {
    let d = TempDir::new().unwrap();
    let e = Engine::open(d.path()).unwrap();
    (d, e)
}
fn save(e: &mut Engine, kind: &str, record: Value) {
    e.call("save", json!({"kind":kind,"record":record}))
        .unwrap();
}
fn person(e: &mut Engine, id: &str) {
    save(e, "people", json!({"id":id,"given_name":id}));
}
fn media(e: &mut Engine) -> String {
    e.call(
        "add_media",
        json!({"filename":"photo.txt","mime":"text/plain","base64":"aGVsbG8="}),
    )
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn event_validation_is_atomic_and_accepts_partial_dates() {
    let (_dir, mut e) = engine();
    person(&mut e, "p");
    save(
        &mut e,
        "events",
        json!({"id":"e","title":"Переезд","start_date":"1947","end_date":"1948-02","person_ids":["p"],"media_ids":[],"latitude":56.1,"longitude":47.2}),
    );
    let before = e.data().unwrap();
    for patch in [
        json!({"end_date":"1946"}),
        json!({"start_date":"1900-02-29"}),
        json!({"latitude":91}),
        json!({"longitude":null}),
        json!({"person_ids":["missing"]}),
        json!({"cover_media_id":"missing"}),
        json!({"title":"  "}),
    ] {
        let mut record = patch;
        record["id"] = json!("e");
        assert!(e
            .call("save", json!({"kind":"events","record":record}))
            .is_err());
        assert_eq!(before, e.data().unwrap());
    }
}

#[test]
fn events_travel_with_branches_and_remap_participants_and_media() {
    let (_ad, mut a) = engine();
    let (_bd, mut b) = engine();
    person(&mut a, "foreign");
    person(&mut b, "local");
    let mid = media(&mut a);
    let local_mid = media(&mut b);
    save(
        &mut a,
        "events",
        json!({"id":"event","title":"Поездка","person_ids":["foreign"],"media_ids":[mid],"cover_media_id":mid,"start_date":"2024-02-29","end_date":"2024-03-02","place":"Москва","latitude":55.75,"longitude":37.62}),
    );
    let pkg = a.branch(&json!({"mode":"all"})).unwrap();
    b.merge(&pkg, &json!({"decisions":{"foreign":"local"}}))
        .unwrap();
    let event = b.data().unwrap()["events"]["event"].clone();
    assert_eq!(event["person_ids"], json!(["local"]));
    assert_eq!(event["media_ids"], json!([local_mid]));
    assert_eq!(event["cover_media_id"], local_mid);
    assert_eq!(event["end_date"], "2024-03-02");
    assert_eq!(b.merge(&pkg, &json!({})).unwrap()["duplicate"], true);
}

#[test]
fn media_removal_updates_events_and_portraits_and_undo_restores_them() {
    let (_d, mut e) = engine();
    person(&mut e, "p");
    let mid = media(&mut e);
    save(
        &mut e,
        "people",
        json!({"id":"p","avatar_id":mid,"avatar_crop":{"x":0.1,"y":0.1,"w":0.5,"h":0.5}}),
    );
    save(
        &mut e,
        "events",
        json!({"id":"event","title":"Фото","person_ids":["p"],"media_ids":[mid],"cover_media_id":mid}),
    );
    e.call(
        "remove",
        json!({"kind":"media","id":mid,"confirm_marked":true}),
    )
    .unwrap();
    let after = e.call("load", json!({})).unwrap();
    assert_eq!(after["data"]["events"][0]["media_ids"], json!([]));
    assert_eq!(after["data"]["events"][0]["cover_media_id"], "");
    assert!(after["data"]["people"][0]["avatar_crop"].is_null());
    assert_eq!(after["trash"]["media"][0]["id"], mid);
    let history = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    e.call("undo", json!({"id":history})).unwrap();
    assert_eq!(
        e.data().unwrap()["events"]["event"]["media_ids"],
        json!([mid])
    );
}

#[test]
fn branch_filters_participants_and_optional_photos_and_local_merge_deduplicates() {
    let (_d, mut e) = engine();
    person(&mut e, "a");
    person(&mut e, "b");
    let mid = media(&mut e);
    save(
        &mut e,
        "people",
        json!({"id":"a","avatar_id":mid,"avatar_crop":{"x":0.1,"y":0.1,"w":0.5,"h":0.5}}),
    );
    save(
        &mut e,
        "events",
        json!({"id":"event","title":"Встреча","person_ids":["a","b"],"media_ids":[mid],"cover_media_id":mid}),
    );
    let branch = e
        .branch(&json!({"mode":"ancestors","root_id":"a","include_media":false}))
        .unwrap();
    assert_eq!(branch.data["events"]["event"]["person_ids"], json!(["a"]));
    assert!(branch.data["media"].is_empty());
    assert!(branch.data["people"]["a"]["avatar_crop"].is_null());
    family_core::validate(&branch.data).unwrap();
    e.call("merge_people", json!({"from_id":"a","to_id":"b"}))
        .unwrap();
    assert_eq!(
        e.data().unwrap()["events"]["event"]["person_ids"],
        json!(["b"])
    );
}

#[test]
fn conflicting_event_versions_are_preserved_without_repeated_duplicates() {
    let (_ad, mut a) = engine();
    let (_bd, mut b) = engine();
    save(
        &mut a,
        "events",
        json!({"id":"event","title":"Старая версия","person_ids":[],"media_ids":[]}),
    );
    b.merge(&a.branch(&json!({"mode":"all"})).unwrap(), &json!({}))
        .unwrap();
    save(
        &mut a,
        "events",
        json!({"id":"event","title":"Новая версия"}),
    );
    assert_eq!(
        b.merge(&a.branch(&json!({"mode":"all"})).unwrap(), &json!({}))
            .unwrap()["conflicts"],
        1
    );
    assert_eq!(b.data().unwrap()["events"].len(), 2);
    assert_eq!(
        b.data().unwrap()["events"]["event"]["title"],
        "Старая версия"
    );
    assert_eq!(
        b.merge(&a.branch(&json!({"mode":"all"})).unwrap(), &json!({}))
            .unwrap()["conflicts"],
        0
    );
    assert_eq!(b.data().unwrap()["events"].len(), 2);
}

#[test]
fn portrait_crop_is_kept_with_its_photo_and_rejects_invalid_regions() {
    let (_ad, mut a) = engine();
    let (_bd, mut b) = engine();
    person(&mut a, "a");
    person(&mut b, "b");
    let mid = media(&mut a);
    let crop = json!({"x":0.1,"y":0.1,"w":0.5,"h":0.5});
    save(
        &mut a,
        "people",
        json!({"id":"a","avatar_id":mid,"avatar_crop":crop}),
    );
    b.merge(
        &a.branch(&json!({"mode":"all"})).unwrap(),
        &json!({"decisions":{"a":"b"}}),
    )
    .unwrap();
    assert_eq!(b.data().unwrap()["people"]["b"]["avatar_crop"], crop);
    let before = b.data().unwrap();
    assert!(b.call("save",json!({"kind":"people","record":{"id":"b","avatar_crop":{"x":0.9,"y":0.1,"w":0.5,"h":0.5}}})).is_err());
    assert_eq!(before, b.data().unwrap());
}

#[test]
fn two_incoming_cards_mapped_to_one_person_make_one_event_participant() {
    let (_ad, mut a) = engine();
    let (_bd, mut b) = engine();
    person(&mut a, "a1");
    person(&mut a, "a2");
    person(&mut b, "local");
    save(
        &mut a,
        "events",
        json!({"id":"event","title":"Встреча","person_ids":["a1","a2"],"media_ids":[]}),
    );
    b.merge(
        &a.branch(&json!({"mode":"all"})).unwrap(),
        &json!({"decisions":{"a1":"local","a2":"local"}}),
    )
    .unwrap();
    assert_eq!(
        b.data().unwrap()["events"]["event"]["person_ids"],
        json!(["local"])
    );
}
