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
    assert theme["sidebar_bg"]
    assert theme["sidebar_active_resolved"] == theme["primary_soft"]
    assert theme["action_secondary_bg"] == theme["surface"]


def test_resolve_custom_sidebar_colors():
    theme = resolve_branding_theme({
        "primary_color": "#E91E8C",
        "sidebar_background": "#1A1020",
        "sidebar_active": "#3D2040",
        "surface": "#FFFFFF",
        "text_primary": "#222222",
        "background": "#FAFAFA",
    })
    assert theme["sidebar_bg"] == "#1A1020"
    assert theme["sidebar_active_resolved"] == "#3D2040"
    assert theme["sidebar_text"]
    assert theme["sidebar_active_text"]


def test_save_strips_derived_fields():
    saved = branding_base_for_save({
        "primary_color": "#112233",
        "primary_hover": "#000000",
        "clinic_name": "X",
        "sidebar_background": "#1A1A1A",
    })
    assert "primary_hover" not in saved
    assert saved["primary_color"] == "#112233"
    assert saved["sidebar_background"] == "#1A1A1A"
    assert "sidebar_active" not in saved
