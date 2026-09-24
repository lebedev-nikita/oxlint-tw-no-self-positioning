#![deny(clippy::all)]

use napi_derive::napi;

/// kind 0: a space-separated Tailwind class string; kind 1: a CSS property and value.
#[napi(object)]
pub struct Candidate {
    pub kind: u32,
    pub text: String,
}

#[napi(object)]
pub struct Finding {
    pub index: u32,
    pub value: String,
    pub group: u32,
}

const MARGIN: u32 = 0;
const POSITION: u32 = 1;
const OFFSET: u32 = 2;
const FLOAT: u32 = 3;
const DIMENSIONS: u32 = 4;
const FLEX_BASIS: u32 = 5;

#[napi]
pub fn scan(candidates: Vec<Candidate>) -> Vec<Finding> {
    let mut findings = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if candidate.kind == 0 {
            for token in candidate.text.split_whitespace() {
                if let Some(group) = class_group(token) {
                    findings.push(Finding {
                        index: index as u32,
                        value: token.to_owned(),
                        group,
                    });
                }
            }
        } else if candidate.kind == 1 {
            if let Some(group) = property_group(&candidate.text) {
                findings.push(Finding {
                    index: index as u32,
                    value: candidate.text.clone(),
                    group,
                });
            }
        }
    }
    findings
}

fn class_group(token: &str) -> Option<u32> {
    let mut last_colon = None;
    let mut segment_start = 0;
    let mut descendant_variant = false;
    let (mut square, mut round, mut escaped) = (0_u32, 0_u32, false);
    for (index, ch) in token.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '[' => square += 1,
            ']' => square = square.saturating_sub(1),
            '(' => round += 1,
            ')' => round = round.saturating_sub(1),
            ':' if square == 0 && round == 0 => {
                let variant = &token[segment_start..index];
                descendant_variant |= matches!(
                    variant,
                    "before"
                        | "after"
                        | "marker"
                        | "placeholder"
                        | "file"
                        | "backdrop"
                        | "selection"
                        | "first-letter"
                        | "first-line"
                        | "*"
                        | "**"
                ) || arbitrary_variant_targets_other_element(variant);
                last_colon = Some(index);
                segment_start = index + 1;
            }
            _ => {}
        }
    }
    if descendant_variant {
        return None;
    }
    let mut base = last_colon.map_or(token, |index| &token[index + 1..]);
    base = base.trim_start_matches('!').trim_end_matches('!');
    base = base.strip_prefix('-').unwrap_or(base);

    if let Some(arbitrary) = base.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        return property_group(arbitrary);
    }
    if matches!(base, "absolute" | "fixed" | "sticky") {
        return Some(POSITION);
    }
    if matches!(
        base,
        "float-left" | "float-right" | "float-start" | "float-end"
    ) || base.starts_with("float-[")
        || base.starts_with("float-(")
    {
        return Some(FLOAT);
    }
    if ["w-", "h-", "size-"]
        .iter()
        .any(|prefix| base.starts_with(prefix))
    {
        return Some(DIMENSIONS);
    }
    if base.starts_with("basis-") {
        return Some(FLEX_BASIS);
    }
    if [
        "top-", "right-", "bottom-", "left-", "inset-", "start-", "end-",
    ]
    .iter()
    .any(|prefix| base.starts_with(prefix))
    {
        return Some(OFFSET);
    }
    if [
        "m-", "mx-", "my-", "mt-", "mr-", "mb-", "ml-", "ms-", "me-", "mbs-", "mbe-",
    ]
    .iter()
    .any(|prefix| base.starts_with(prefix))
    {
        return Some(MARGIN);
    }
    // `flex` itself is display:flex; these are flex shorthand utilities.
    let flex = base.strip_prefix("flex-");
    flex.filter(|rest| {
        matches!(*rest, "auto" | "initial" | "none")
            || rest.starts_with('[')
            || rest.starts_with('(')
            || rest.as_bytes().first().is_some_and(u8::is_ascii_digit)
    })
    .map(|_| FLEX_BASIS)
}

fn arbitrary_variant_targets_other_element(variant: &str) -> bool {
    let Some(selector) = variant.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else {
        return false;
    };
    let (mut square, mut round, mut quote, mut escaped, mut after_root) =
        (0_u32, 0_u32, None, false, false);
    let (mut branch_has_root, mut branch_targets_other) = (false, false);
    for ch in selector.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(delimiter) = quote {
            if ch == delimiter {
                quote = None;
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        match ch {
            '[' => square += 1,
            ']' => square = square.saturating_sub(1),
            '(' => round += 1,
            ')' => round = round.saturating_sub(1),
            '&' if square == 0 && round == 0 => {
                branch_has_root = true;
                after_root = true;
            }
            '_' | '>' | '+' | '~' if after_root && square == 0 && round == 0 => {
                branch_targets_other = true;
            }
            ',' if square == 0 && round == 0 => {
                if !branch_has_root || !branch_targets_other {
                    return false;
                }
                branch_has_root = false;
                branch_targets_other = false;
                after_root = false;
            }
            _ => {}
        }
    }
    branch_has_root && branch_targets_other
}

fn property_group(text: &str) -> Option<u32> {
    let (property, value) = text.split_once(':').unwrap_or((text, ""));
    let property: String = property
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_')
        .flat_map(char::to_lowercase)
        .collect();
    if property == "position" {
        return (!value.trim().is_empty()
            && !value.trim().eq_ignore_ascii_case("static")
            && !value.trim().eq_ignore_ascii_case("relative"))
        .then_some(POSITION);
    }
    if matches!(property.as_str(), "float" | "cssfloat") {
        return (!value.trim().is_empty() && !value.trim().eq_ignore_ascii_case("none"))
            .then_some(FLOAT);
    }
    if property.starts_with("margin") {
        return Some(MARGIN);
    }
    if matches!(
        property.as_str(),
        "top"
            | "right"
            | "bottom"
            | "left"
            | "inset"
            | "insetblock"
            | "insetblockstart"
            | "insetblockend"
            | "insetinline"
            | "insetinlinestart"
            | "insetinlineend"
    ) {
        return Some(OFFSET);
    }
    match property.as_str() {
        "width" | "height" => Some(DIMENSIONS),
        "flexbasis" | "flex" => Some(FLEX_BASIS),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_requested_utilities_and_variants() {
        for class in [
            "m-0",
            "-mx-4",
            "md:hover:!mt-2",
            "ms-auto",
            "mbs-2",
            "absolute",
            "fixed",
            "sticky",
            "md:float-left",
            "float-end",
            "float-[inline-start]",
            "lg:-left-[2px]",
            "inset-x-0",
            "start-1",
            "w-full",
            "h-20",
            "size-4",
            "basis-1/2",
            "flex-1",
            "flex-[2_2_0%]",
            "[margin-top:1px]",
            "hover:[width:50%]",
            "md:[height:20px]",
            "[position:absolute]",
            "[float:left]",
            "[inset-inline-start:0]",
        ] {
            assert!(class_group(class).is_some(), "{class}");
        }
    }

    #[test]
    fn permits_other_utilities() {
        for class in [
            "max-w-md",
            "min-w-0",
            "max-h-screen",
            "min-h-0",
            "static",
            "float-none",
            "clearfix",
            "flex",
            "flex-row",
            "flex-wrap",
            "text-left",
            "border-l-2",
            "shadow-lg",
            "wobbly",
            "[max-width:4rem]",
            "[position:static]",
            "relative",
            "md:hover:!relative",
            "[position:relative]",
            "hover:[position:relative]",
            "[float:none]",
            "bg-[url(data:image/svg+xml;a:b)]",
            "before:absolute",
            "md:after:mt-2",
            "*:w-full",
            "[&_svg:not([class*='size-'])]:size-3",
            "[&>svg]:w-4",
            "hover:[&_span]:mt-2",
            "[&_svg,&_span]:size-3",
        ] {
            assert!(class_group(class).is_none(), "{class}");
        }
    }

    #[test]
    fn keeps_arbitrary_variants_targeting_the_root() {
        for class in [
            "[&:hover]:w-8",
            "[&:not(.compact)]:size-3",
            "[.container_&]:mt-2",
            "[&:has(>svg)]:w-4",
            "[&:has(svg)]:absolute",
            "[&[data-name='a_b']]:w-4",
            "[&_svg,&:hover]:w-4",
        ] {
            assert!(class_group(class).is_some(), "{class}");
        }
    }

    #[test]
    fn checks_inline_properties() {
        for property in [
            "marginTop:0",
            "margin-inline:1px",
            "width:20",
            "height:20",
            "flexBasis:0",
            "flex:1",
            "left:0",
            "insetBlockStart:0",
            "position:absolute",
            "position:fixed",
            "position:sticky",
            "cssFloat:left",
            "float:inline-start",
        ] {
            assert!(property_group(property).is_some(), "{property}");
        }
        for property in [
            "maxWidth:20",
            "min-width:0",
            "maxHeight:20",
            "min-height:0",
            "position:static",
            "position:relative",
            "position: Relative ",
            "float:none",
            "padding:8",
            "transform:translateX(2px)",
        ] {
            assert!(property_group(property).is_none(), "{property}");
        }
    }

    #[test]
    fn classifies_each_rule_group() {
        for (class, group) in [
            ("mt-2", MARGIN),
            ("absolute", POSITION),
            ("left-0", OFFSET),
            ("float-left", FLOAT),
            ("w-80", DIMENSIONS),
            ("h-20", DIMENSIONS),
            ("size-4", DIMENSIONS),
            ("basis-1/2", FLEX_BASIS),
            ("flex-1", FLEX_BASIS),
            ("[margin-top:1px]", MARGIN),
            ("[inset-inline-start:0]", OFFSET),
        ] {
            assert_eq!(class_group(class), Some(group), "{class}");
        }
        for (property, group) in [
            ("marginTop:2", MARGIN),
            ("position:absolute", POSITION),
            ("insetInlineStart:0", OFFSET),
            ("cssFloat:left", FLOAT),
            ("width:80", DIMENSIONS),
            ("height:20", DIMENSIONS),
            ("flexBasis:0", FLEX_BASIS),
            ("flex:1", FLEX_BASIS),
        ] {
            assert_eq!(property_group(property), Some(group), "{property}");
        }
    }
}
