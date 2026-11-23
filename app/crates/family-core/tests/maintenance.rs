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
fn media(e: &mut Engine, id: &str, hash: &str) {
    save(
        e,
        "media",
        json!({"id":id,"title":id,"sha256":hash,"mime":"image/jpeg","file":"media/test.jpg","thumb":"","date":"1901","comment":"История фото"}),
    );
}
fn person(e: &mut Engine, id: &str) {
    save(e, "people", json!({"id":id,"given_name":id}));
}
fn tag(e: &mut Engine, id: &str, mid: &str, pid: &str) {
    save(
        e,
        "tags",
        json!({"id":id,"media_id":mid,"person_id":pid,"x":0.1,"y":0.1,"w":0.2,"h":0.2,"comment":"Исходная подпись"}),
    );
}
fn load(e: &mut Engine) -> Value {
    e.call("load", json!({})).unwrap()
}

#[test]
fn trash_warns_and_restores_all_original_links_without_erasing_files_or_metadata() {
    let (_dir, mut e) = engine();
    person(&mut e, "p");
    media(&mut e, "m", "hash");
    tag(&mut e, "t", "m", "p");
    save(
        &mut e,
        "people",
        json!({"id":"p","avatar_id":"m","avatar_crop":{"x":0.1,"y":0.1,"w":0.2,"h":0.2}}),
    );
    save(
        &mut e,
        "events",
        json!({"id":"e","title":"Встреча","media_ids":["m"],"cover_media_id":"m","person_ids":["p"]}),
    );
    let original = e.data().unwrap();
    let preview = e
        .call("trash_preview", json!({"kind":"media","ids":["m"]}))
        .unwrap();
    assert_eq!(preview["people"][0]["id"], "p");
    assert!(e
        .call("trash_items", json!({"kind":"media","ids":["m"]}))
        .is_err());
    assert_eq!(original, e.data().unwrap());
    e.call(
        "trash_items",
        json!({"kind":"media","ids":["m"],"confirm_marked":true}),
    )
    .unwrap();
    let view = load(&mut e);
    assert!(view["data"]["media"].as_array().unwrap().is_empty());
    assert!(view["data"]["tags"].as_array().unwrap().is_empty());
    assert_eq!(view["data"]["people"][0]["avatar_id"], "");
    assert_eq!(view["data"]["events"][0]["media_ids"], json!([]));
    assert_eq!(view["trash"]["media"][0]["comment"], "История фото");
    let exported = e.branch(&json!({"mode":"all"})).unwrap();
    assert!(exported.data["media"].is_empty());
    family_core::validate(&exported.data).unwrap();
    e.call("restore_items", json!({"kind":"media","ids":["m"]}))
        .unwrap();
    assert_eq!(original, e.data().unwrap());
}

#[test]
fn exact_file_duplicates_preserve_tags_events_portraits_and_can_be_undone() {
    let (_dir, mut e) = engine();
    person(&mut e, "p");
    person(&mut e, "q");
    media(&mut e, "a", "same");
    media(&mut e, "b", "same");
    tag(&mut e, "ta", "a", "p");
    tag(&mut e, "tb", "b", "q");
    save(&mut e, "people", json!({"id":"q","avatar_id":"b"}));
    save(
        &mut e,
        "events",
        json!({"id":"e","title":"Фото","media_ids":["a","b"],"cover_media_id":"b"}),
    );
    assert_eq!(
        e.call("find_duplicates", json!({"kind":"media"}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let original = e.data().unwrap();
    e.call(
        "merge_duplicates",
        json!({"kind":"media","keep_id":"a","ids":["b"],"confirm_marked":true}),
    )
    .unwrap();
    let view = load(&mut e);
    assert_eq!(view["data"]["media"].as_array().unwrap().len(), 1);
    assert_eq!(view["data"]["tags"].as_array().unwrap().len(), 2);
    assert!(view["data"]["tags"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t["media_id"] == "a"));
    assert_eq!(view["data"]["events"][0]["media_ids"], json!(["a"]));
    assert_eq!(view["data"]["events"][0]["cover_media_id"], "a");
    assert_eq!(view["data"]["people"][1]["avatar_id"], "a");
    family_core::validate(&e.branch(&json!({"mode":"all"})).unwrap().data).unwrap();
    e.call("undo", json!({"id":view["history"][0]["id"]}))
        .unwrap();
    assert_eq!(original, e.data().unwrap());
}

#[test]
fn different_files_cannot_be_merged_as_exact_duplicates() {
    let (_dir, mut e) = engine();
    media(&mut e, "a", "hash-a");
    media(&mut e, "b", "hash-b");
    let before = e.data().unwrap();
    assert!(e
        .call(
            "merge_duplicates",
            json!({"kind":"media","keep_id":"a","ids":["b"],"confirm_marked":true})
        )
        .is_err());
    assert_eq!(before, e.data().unwrap());
}

#[test]
fn unknown_person_marks_also_require_confirmation_before_trash_or_merge() {
    let (_dir, mut e) = engine();
    media(&mut e, "a", "same");
    media(&mut e, "b", "same");
    save(
        &mut e,
        "tags",
        json!({"id":"unknown","media_id":"b","person_id":"","label":"Кто это?","x":0.1,"y":0.1,"w":0.2,"h":0.2}),
    );
    let before = e.data().unwrap();
    assert!(e
        .call("trash_items", json!({"kind":"media","ids":["b"]}))
        .is_err());
    assert!(e
        .call(
            "merge_duplicates",
            json!({"kind":"media","ids":["b"],"keep_id":"a"})
        )
        .is_err());
    assert_eq!(before, e.data().unwrap());
    e.call(
        "trash_items",
        json!({"kind":"media","ids":["b"],"confirm_marked":true}),
    )
    .unwrap();
    e.call("restore_items", json!({"kind":"media","ids":["b"]}))
        .unwrap();
    assert_eq!(before, e.data().unwrap());
}

#[test]
fn text_duplicate_comparison_keeps_word_boundaries_in_lists_and_line_breaks() {
    let (_dir, mut e) = engine();
    for (id, content) in [
        (
            "line",
            json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Семейная"},{"type":"hardBreak"},{"type":"text","text":"история"}]}]}),
        ),
        (
            "list",
            json!({"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Семейная"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"история"}]}]}]}]}),
        ),
        (
            "word",
            json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Семейнаяистория"}]}]}),
        ),
    ] {
        save(
            &mut e,
            "texts",
            json!({"id":id,"title":id,"content":content}),
        );
    }
    let groups = e.call("find_duplicates", json!({"kind":"texts"})).unwrap();
    assert_eq!(groups.as_array().unwrap().len(), 1);
    assert_eq!(groups[0].as_array().unwrap().len(), 2);
    assert!(groups[0]
        .as_array()
        .unwrap()
        .iter()
        .all(|v| v["id"] != "word"));
}

#[test]
fn duplicate_texts_keep_distinct_mentions_and_restore_original_documents() {
    let (_dir, mut e) = engine();
    person(&mut e, "p");
    person(&mut e, "q");
    for (id, person, text) in [
        ("a", "p", "Семейная история"),
        ("b", "q", "Семейная   история"),
    ] {
        save(
            &mut e,
            "texts",
            json!({"id":id,"title":id,"author_id":person,"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text,"marks":[{"type":"personLink","attrs":{"personId":person}}]}]}]}}),
        );
    }
    let originals = e.data().unwrap()["texts"].clone();
    assert_eq!(
        e.call("find_duplicates", json!({"kind":"texts"}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    e.call(
        "merge_duplicates",
        json!({"kind":"texts","ids":["b"],"keep_id":"a","confirm_marked":true}),
    )
    .unwrap();
    let v = load(&mut e);
    assert_eq!(v["data"]["texts"].as_array().unwrap().len(), 1);
    assert!(v["data"]["text_links"]
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["person_id"] == "q" && l["text_id"] == "a"));
    assert_eq!(v["trash"]["texts"][0]["content"], originals["b"]["content"]);
    e.call(
        "save",
        json!({"kind":"texts","record":{"id":"a"},"subjects":[]}),
    )
    .unwrap();
    assert!(load(&mut e)["data"]["text_links"]
        .as_array()
        .unwrap()
        .is_empty());
    e.call("restore_items", json!({"kind":"texts","ids":["b"]}))
        .unwrap();
    assert_eq!(
        e.data().unwrap()["texts"]["b"]["content"],
        originals["b"]["content"]
    );
}

#[test]
fn importing_an_existing_file_from_trash_does_not_hide_the_incoming_material() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    media(&mut a, "m", "same");
    media(&mut b, "m", "same");
    b.call("trash_items", json!({"kind":"media","ids":["m"]}))
        .unwrap();
    b.merge(&a.branch(&json!({"mode":"all"})).unwrap(), &json!({}))
        .unwrap();
    let view = load(&mut b);
    assert_eq!(
        view["data"]["media"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["sha256"] == "same")
            .count(),
        1
    );
    assert_eq!(view["trash"]["media"].as_array().unwrap().len(), 1);
}

fn indexed(e: &mut Engine, id: &str, value: f64) {
    media(e, id, &format!("hash-{id}"));
    let mut descriptor = vec![0.0; 128];
    descriptor[0] = value;
    e.call("analysis_put",json!({"kind":"faces","version":"test-v1","media_id":id,"sha256":format!("hash-{id}"),"payload":{"width":1000,"height":1000,"faces":[{"id":"face","x":0.1,"y":0.1,"w":0.2,"h":0.2,"score":0.95,"descriptor":descriptor}]}})).unwrap();
}
#[test]
fn automatic_matches_need_two_confirmed_photos_and_do_not_train_on_themselves() {
    let (_d, mut e) = engine();
    person(&mut e, "p");
    indexed(&mut e, "a", 0.0);
    indexed(&mut e, "b", 0.02);
    indexed(&mut e, "c", 0.03);
    tag(&mut e, "ta", "a", "p");
    assert!(e
        .call("face_matches", json!({"version":"test-v1","person_id":"p"}))
        .unwrap()["automatic"]
        .as_array()
        .unwrap()
        .is_empty());
    tag(&mut e, "tb", "b", "p");
    let result = e
        .call("face_tag_batch", json!({"version":"test-v1","mode":"auto"}))
        .unwrap();
    assert_eq!(result["assigned"], 1);
    let auto = e.data().unwrap()["tags"]
        .values()
        .find(|t| t["media_id"] == "c")
        .unwrap()
        .clone();
    assert_eq!(auto["recognition_confirmed"], false);
    e.call("remove", json!({"kind":"tags","id":"ta"})).unwrap();
    indexed(&mut e, "d", 0.04);
    assert_eq!(
        e.call("face_tag_batch", json!({"version":"test-v1","mode":"auto"}))
            .unwrap()["assigned"],
        0
    );
    e.call(
        "face_tag_batch",
        json!({"version":"test-v1","mode":"review","person_id":"p","face_ids":["c:face"]}),
    )
    .unwrap();
    assert_eq!(
        e.call("face_tag_batch", json!({"version":"test-v1","mode":"auto"}))
            .unwrap()["assigned"],
        2
    );
}
#[test]
fn batch_tagging_preserves_unframed_notes_skips_other_people_and_undoes_as_one_action() {
    let (_d, mut e) = engine();
    person(&mut e, "p");
    person(&mut e, "q");
    indexed(&mut e, "a", 0.0);
    indexed(&mut e, "b", 0.01);
    indexed(&mut e, "c", 0.02);
    save(
        &mut e,
        "tags",
        json!({"id":"unframed","media_id":"a","person_id":"p","x":null,"comment":"Старая подпись"}),
    );
    tag(&mut e, "other", "c", "q");
    let before = e.data().unwrap();
    let result=e.call("face_tag_batch",json!({"version":"test-v1","mode":"review","person_id":"p","face_ids":["a:face","b:face","c:face"]})).unwrap();
    assert_eq!(result["assigned"], 2);
    assert_eq!(result["conflicts"], 1);
    assert_eq!(
        e.data().unwrap()["tags"]["unframed"]["comment"],
        "Старая подпись"
    );
    assert_eq!(e.data().unwrap()["tags"]["other"]["person_id"], "q");
    let h = load(&mut e)["history"][0]["id"].clone();
    e.call("undo", json!({"id":h})).unwrap();
    assert_eq!(before, e.data().unwrap());
}
#[test]
fn ambiguous_people_are_not_automatically_assigned_and_trash_is_not_searched() {
    let (_d, mut e) = engine();
    person(&mut e, "p");
    person(&mut e, "q");
    for (id, v, p) in [
        ("a", 0.0, "p"),
        ("b", 0.02, "p"),
        ("q1", 0.04, "q"),
        ("q2", 0.05, "q"),
    ] {
        indexed(&mut e, id, v);
        tag(&mut e, &format!("tag-{id}"), id, p);
    }
    indexed(&mut e, "candidate", 0.025);
    assert!(e
        .call("face_matches", json!({"version":"test-v1"}))
        .unwrap()["automatic"]
        .as_array()
        .unwrap()
        .is_empty());
    e.call("trash_items", json!({"kind":"media","ids":["candidate"]}))
        .unwrap();
    assert!(e.call("face_tag_batch",json!({"version":"test-v1","mode":"review","person_id":"p","face_ids":["candidate:face"]})).is_err());
    assert_eq!(
        e.call("analysis_get", json!({"kind":"faces","version":"test-v1"}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        4
    );
}
#[test]
fn image_cache_validates_model_vectors_and_current_archive() {
    let (_d, mut e) = engine();
    media(&mut e, "m", "hash");
    let history = load(&mut e)["history"].clone();
    assert!(e.call("analysis_put",json!({"kind":"faces","version":"v","media_id":"m","sha256":"hash","payload":{"faces":[{"id":"x","x":0.1,"y":0.1,"w":0.2,"h":0.2,"score":1,"descriptor":[1,2]}]}})).is_err());
    assert!(e.call("analysis_put",json!({"kind":"image","version":"v","tree_id":"wrong-tree","media_id":"m","sha256":"hash","payload":{"hash":"0000000000000000","aspect":1}})).is_err());
    e.call("analysis_put",json!({"kind":"image","version":"v","media_id":"m","sha256":"hash","payload":{"hash":"0000000000000000","aspect":1}})).unwrap();
    assert_eq!(history, load(&mut e)["history"]);
}

#[test]
fn face_groups_include_single_unidentified_faces_and_reviewing_them_is_read_only() {
    let (_d, mut e) = engine();
    indexed(&mut e, "a", 0.0);
    indexed(&mut e, "b", 0.01);
    indexed(&mut e, "single", 1.4);
    let before = load(&mut e);
    let result = e.call("face_matches", json!({"version":"test-v1","groups":true})).unwrap();
    let groups = result["groups"].as_array().unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].as_array().unwrap().len(), 2);
    assert_eq!(groups[1][0]["media_id"], "single");
    assert_eq!(before, load(&mut e));
}
