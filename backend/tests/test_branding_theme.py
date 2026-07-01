from branding_theme import branding_base_for_save, resolve_branding_theme


def test_resolve_derives_semantic_tokens():
    theme = resolve_branding_theme({
        "primary_color": "#336699",
        "text_primary": "#222222",
        "surface": "#FFFFFF",
        "background": "#FDFBF7",
    })
    assert theme["primary_hover"] != theme["primary_color"]
    assert theme["primary_soft"] != theme["primary_color"]
    assert theme["border_color"]
    assert theme["muted_text"] != theme["text_primary"]
    assert theme["link_color"] == theme["primary_color"]


def test_save_strips_derived_fields():
    saved = branding_base_for_save({
        "primary_color": "#112233",
        "primary_hover": "#000000",
        "clinic_name": "X",
    })
    assert "primary_hover" not in saved
    assert saved["primary_color"] == "#112233"
