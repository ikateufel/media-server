from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


# Configuração em JSON (relativamente à raiz do projecto):
#   data/tag-rules/tags.json   → { "needles": ["put", "..."] }
#   data/tag-rules/garbage.json → { "words": ["the", "..."] }  (também aceita chave "garbage")
#

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES_DIR = PROJECT_ROOT / "data" / "tag-rules"
DEFAULT_TAGS_JSON = DEFAULT_RULES_DIR / "tags.json"
DEFAULT_GARBAGE_JSON = DEFAULT_RULES_DIR / "garbage.json"


@dataclass(frozen=True)
class TagConfig:
    garbage: frozenset[str]
    needles: tuple[str, ...]


_CFG = TagConfig(frozenset(), tuple())


def _load_needles_json(path: Path) -> tuple[str, ...]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "needles" in data:
        arr = data["needles"]
    elif isinstance(data, list):
        arr = data
    else:
        raise ValueError(f'{path}: usa {{"needles": [...]}} ou uma lista de strings.')
    out: list[str] = []
    for x in arr:
        if not isinstance(x, str):
            continue
        s = x.strip().lower()
        if len(s) >= 2:
            out.append(s)
    return tuple(out)


def _load_garbage_json(path: Path) -> frozenset[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        if "words" in data:
            arr = data["words"]
        elif "garbage" in data:
            arr = data["garbage"]
        else:
            raise ValueError(f'{path}: objecto deve ter «words» ou «garbage» com a lista.')
    elif isinstance(data, list):
        arr = data
    else:
        raise ValueError(f"{path}: formato inválido.")

    lex: set[str] = set()
    for x in arr:
        if not isinstance(x, str):
            continue
        s = x.strip().lower()
        if s:
            lex.add(s)
    return frozenset(lex)


def reload_tag_cfg(*, tags_json: str | Path | None = None, garbage_json: str | Path | None = None) -> None:
    """Lê só JSON da pasta tag-rules ou caminhos passados (--tags-json / --garbage-json)."""
    global _CFG
    tp = (Path(tags_json).expanduser() if tags_json else DEFAULT_TAGS_JSON).resolve()
    gp = (Path(garbage_json).expanduser() if garbage_json else DEFAULT_GARBAGE_JSON).resolve()

    missing = [str(p) for p in (tp, gp) if not p.is_file()]
    if missing:
        print(
            "[tag-from-names] Erro: falta(m) JSON de regras:\n  "
            + "\n  ".join(missing)
            + "\n  Por defeito espera-se um par em data/tag-rules/ (tags.json + garbage.json).",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        needles = _load_needles_json(tp)
        garbage_lex = _load_garbage_json(gp)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
        print(f"[tag-from-names] Erro ao ler regras: {e}", file=sys.stderr)
        sys.exit(1)

    if not needles:
        print("[tag-from-names] Aviso: «needles» vazio em", tp, file=sys.stderr)

    _CFG = TagConfig(garbage=garbage_lex, needles=needles)


PREFIXOS_NO_NOME = ("putaria", "put", "men", "buc", "cor", "comedia")

# Palavras que NUNCA devem fazer parte de uma frase de nome composto, mas
# podem continuar a ser tag por outros caminhos (estúdios, categorias, etc.).
NAME_DUD_ANY = frozenset(
    {
        # estúdios / marcas comuns que aparecem antes do nome
        "milfy",
        "studio",
        "studios",
        "presents",
        # categorias que viram trigramas falsos com nomes ao lado
        "milf",
        "milfs",
        "gilf",
        "teen",
        "teens",
        "anal",
        "oral",
        "double",
        "triple",
        "mom",
        "moms",
        "mommy",
        "dad",
        "dads",
        "daddy",
        "son",
        "daughter",
        "daughters",
        "brother",
        "sister",
        "wife",
        "husband",
        "girl",
        "girls",
        "boy",
        "boys",
        "step",
        "stepmom",
        "stepdad",
        "stepson",
        "stepdaughter",
        "stepsister",
        "stepbrother",
        "stepmother",
        "stepfather",
    }
)

# No meio de um suposto nome composto, estas palavras indicam título inglês, não pessoa.
NAME_DUD_MIDDLE = frozenset(
    {
        "in",
        "at",
        "the",
        "of",
        "and",
        "or",
        "for",
        "to",
        "on",
        "is",
        "it",
        "an",
        "as",
        "by",
        "be",
        "we",
        "he",
        "she",
        "they",
        "my",
        "your",
        "but",
        "not",
        "if",
        "so",
        "from",
        "with",
        "into",
        "over",
        "out",
        "up",
        "down",
        "a",
        "without",
        "versus",
        "vs",
    }
)


def _has_vowel(s: str) -> bool:
    return bool(re.search(r"[aeiouyáéíóúâêîôûàèìòùãõ]", s, re.I))


def _likely_person_name_phrase(phrase: str) -> bool:
    """Heurística simples: parece nome próprio (incl. composto) vs. frase de título."""
    pl = phrase.strip()
    if len(pl) < 5:
        return False
    parts = pl.split()
    if len(parts) < 2:
        return False
    if any(p.lower() in _CFG.garbage for p in parts):
        return False
    if any(p.lower() in NAME_DUD_ANY for p in parts):
        return False
    for p in parts[1:]:
        if p.lower() in NAME_DUD_MIDDLE:
            return False
    low = pl.lower()
    if not _has_vowel(low):
        return False
    if any(c.isdigit() for c in low):
        return False
    if _is_garbage_tag(low):
        return False
    return True


def _likely_person_name_token(word: str) -> bool:
    """Uma palavra Title Case isolada (após tirar compostos)."""
    wl = word.strip().lower()
    if len(wl) < 3 or wl in _CFG.garbage or wl in NAME_DUD_MIDDLE:
        return False
    if not _has_vowel(wl):
        return False
    if any(c.isdigit() for c in wl):
        return False
    return not _is_garbage_tag(wl)


def _split_camel_case_gap(s: str) -> str:
    """camelCase ou … dígito+Title → espaço (aceita partir compostos pegados assim)."""
    return re.sub(r"([a-z0-9])([A-Z][a-z])", r"\1 \2", s)


def _split_stuck_titlecase_words(s: str) -> str:
    """Divide Title grudado sem espaço (ex.: JuliaAnn → Julia Ann)."""
    prev = ""
    while prev != s:
        prev = s
        s = re.sub(r"\b([A-Z][a-z]{2,})([A-Z][a-z]{2,})\b", r"\1 \2", s)
    return s


def _titulo_para_scan_de_nomes(stem: str) -> str:
    """Remove blocos [...] (…) e normaliza separadores — só o que sobra do título."""
    s = re.sub(r"\[[^\]]*\]", " ", stem)
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"[._\-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    prev = ""
    while prev != s:
        prev = s
        s = _split_camel_case_gap(s)

    s = _split_stuck_titlecase_words(s)
    return re.sub(r"\s+", " ", s).strip()


def _whitespace_only_gap(s: str, start: int, end: int) -> bool:
    if start >= end:
        return True
    return not re.search(r"\S", s[start:end])


def _name_token_spans(scan: str) -> list[tuple[str, int, int]]:
    """Tokens estilo nome próprio (Title Case ou McKay)."""
    pat = re.compile(r"\b((?:Mc[A-Z][a-z]{2,}|[A-Z][a-z]{2,}))\b")
    return [(m.group(1), m.start(), m.end()) for m in pat.finditer(scan)]


def _pick_non_overlapping_ngrams(
    cands: list[tuple[int, int, str, tuple[int, ...]]],
) -> list[tuple[int, int, str, tuple[int, ...]]]:
    cands = sorted(cands, key=lambda x: (x[0], -(x[1] - x[0])))
    out: list[tuple[int, int, str, tuple[int, ...]]] = []
    last_end = -1
    for s, e, ph, idxs in cands:
        if s < last_end:
            continue
        out.append((s, e, ph, idxs))
        last_end = e
    return out


def _lowercase_pair_runs(scan: str) -> set[str]:
    """
    Para ficheiros tipo «studio.YY.MM.DD.nome.nome.nome.nome…» (tudo minúsculas):
    encontra «runs» de palavras minúsculas (3+ chars, sem garbage/dud/dígitos/PREFIXO)
    delimitadas por dígitos ou stop-words, e empareha 2 a 2.

    Só actua quando o run tem >= 4 tokens (claramente lista de nomes), para evitar
    falsos positivos como `bellesafilms ember` (estúdio + 1.º nome).
    """
    out: set[str] = set()
    # também apanhamos palavras Title Case para servirem de separador do run minúsculo
    pat = re.compile(r"\b([A-Za-z][A-Za-z]{2,}|\d+)\b")

    runs: list[list[str]] = []
    cur: list[str] = []

    def flush() -> None:
        nonlocal cur
        if len(cur) >= 4:
            runs.append(cur)
        cur = []

    for m in pat.finditer(scan):
        text = m.group(1)
        if text.isdigit():
            flush()
            continue
        if text[0].isupper():
            flush()
            continue
        wl = text.lower()
        if (
            wl in _CFG.garbage
            or wl in NAME_DUD_MIDDLE
            or wl in NAME_DUD_ANY
            or wl in PREFIXOS_NO_NOME
            or _is_garbage_tag(wl)
            or not _has_vowel(wl)
        ):
            flush()
            continue
        cur.append(wl)
    flush()

    for run in runs:
        i = 0
        while i + 1 < len(run):
            phrase = f"{run[i]} {run[i + 1]}"
            if _likely_person_name_phrase(phrase):
                out.add(phrase)
            i += 2

    return out


def _dedupe_singles_absorvidos_em_compostos(tags: set[str]) -> set[str]:
    """Se há palavra solta e composto com essa palavra, fica a solta (ex.: juke + juke box → juke, box)."""
    return filtrar_tags_redundantes(tags)


def extrair_nomes_titlecase_do_titulo(stem: str) -> set[str]:
    """
    Procura sequências estilo Nome Próprio (ex.: Julia Ann, Mary Jane Watson) no resto do ficheiro.
    Usa janelas deslizantes em tokens (não regex finditer em trigramas), para não perder
    «Mary Jane Watson» quando «Title Mary Jane» é um match regex mas é rejeitado pela heurística.
    """
    scan = _titulo_para_scan_de_nomes(stem)
    if not scan:
        return set()
    out: set[str] = set()
    tok = _name_token_spans(scan)
    if not tok:
        out |= _lowercase_pair_runs(scan)
        return _dedupe_singles_absorvidos_em_compostos(out)

    mask = list(scan)
    used_idx: set[int] = set()

    def apply_span(s: int, e: int) -> None:
        for k in range(s, min(e, len(mask))):
            mask[k] = " "

    c3: list[tuple[int, int, str, tuple[int, int, int]]] = []
    for i in range(len(tok) - 2):
        w0, s0, e0 = tok[i]
        w1, s1, e1 = tok[i + 1]
        w2, s2, e2 = tok[i + 2]
        if not (
            _whitespace_only_gap(scan, e0, s1) and _whitespace_only_gap(scan, e1, s2)
        ):
            continue
        phrase = f"{w0} {w1} {w2}"
        if _likely_person_name_phrase(phrase):
            c3.append((s0, e2, phrase, (i, i + 1, i + 2)))

    for s, e, ph, tri in _pick_non_overlapping_ngrams(c3):
        out.add(ph.strip().lower())
        for j in tri:
            used_idx.add(j)
        apply_span(s, e)

    c2: list[tuple[int, int, str, tuple[int, int]]] = []
    for i in range(len(tok) - 1):
        if i in used_idx or (i + 1) in used_idx:
            continue
        w0, s0, e0 = tok[i]
        w1, s1, e1 = tok[i + 1]
        if not _whitespace_only_gap(scan, e0, s1):
            continue
        phrase = f"{w0} {w1}"
        if _likely_person_name_phrase(phrase):
            c2.append((s0, e1, phrase, (i, i + 1)))

    for s, e, ph, pair in _pick_non_overlapping_ngrams(c2):
        out.add(ph.strip().lower())
        for j in pair:
            used_idx.add(j)
        apply_span(s, e)

    for j, (w, _s, _e) in enumerate(tok):
        if j in used_idx:
            continue
        if _likely_person_name_token(w):
            out.add(w.lower())

    out |= _lowercase_pair_runs(scan)

    return _dedupe_singles_absorvidos_em_compostos(out)


def _is_year_token(s: str) -> bool:
    t = s.strip().strip("()[]")
    return bool(re.match(r"^(19|20)\d{2}$", t))


# Resolução / codec / contentor / release scene — nunca viram tag.
_TECH_NOISE = frozenset(
    {
        "1080p",
        "2160p",
        "1440p",
        "720p",
        "480p",
        "360p",
        "240p",
        "4k",
        "8k",
        "uhd",
        "fhd",
        "qhd",
        "hd",
        "sd",
        "hdr",
        "hevc",
        "h264",
        "h265",
        "x264",
        "x265",
        "avc",
        "aac",
        "ac3",
        "dts",
        "mp4",
        "mkv",
        "avi",
        "mov",
        "wmv",
        "webm",
        "m4v",
        "xxx",
        "p2p",
        "webrip",
        "webdl",
        "bluray",
        "bdrip",
        "brrip",
        "hdtv",
        "dvdrip",
        "dvd",
        "proper",
        "repack",
        "internal",
        "remux",
        "encode",
        "encoded",
        "nf",
        "amzn",
        "dsnp",
        "hulu",
        "dl",
        "web",
        "xc",
        "rarbg",
        "yify",
        "yts",
        "sparks",
        "ntb",
        "flux",
        "vostfr",
        "multi",
        "subbed",
        "softsub",
        "hardsub",
        "media",
        "scene",
        "scenes",
        "split",
        "vol",
        "episode",
        "part",
    }
)

# Plataformas / tube / cam — ruído de site, não estúdio útil.
_SITE_NOISE = frozenset(
    {
        "onlyfans",
        "fansly",
        "manyvids",
        "pornhub",
        "xvideos",
        "xnxx",
        "xhamster",
        "redtube",
        "youporn",
        "spankbang",
        "chaturbate",
        "stripchat",
        "cam4",
        "bongacams",
        "livejasmin",
        "myfreecams",
        "clips4sale",
        "iwantclips",
        "patreon",
        "twitter",
        "instagram",
        "reddit",
        "tiktok",
        "youtube",
        "vimeo",
        "telegram",
        "discord",
    }
)

# Artigos / preposições curtas sem valor de pesquisa.
_STOP_NOISE = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "to",
        "for",
        "in",
        "on",
        "at",
        "by",
        "with",
        "from",
        "is",
        "it",
        "as",
        "be",
        "vs",
        "via",
    }
)

_RES_TOKEN_RE = re.compile(
    r"^(?:\d{3,4}p|p\d{3,4}|\d+k)$",
    re.I,
)
_WEB_DL_RE = re.compile(r"^web[\-_]?dl$", re.I)


def _is_technical_paren(inner: str) -> bool:
    """True se o conteúdo entre parênteses for só ano / codec / resolução."""
    low = inner.lower()
    if _is_year_token(inner):
        return True
    if re.search(
        r"\b(1080p|720p|480p|2160p|4k|uhd|hevc|h\.?264|h\.?265|x264|x265|webrip|bluray|p2p|xxx)\b",
        low,
    ):
        return True
    if re.fullmatch(r"[\d\s.pkxhvecu\-]+", low) and len(low) <= 32:
        return True
    return False


def _is_garbage_tag(t: str) -> bool:
    """Ruído técnico / site / número — não entra nas auto-tags."""
    tl = t.strip().lower().strip(".-_/")
    if len(tl) < 2:
        return True
    parts = [p for p in re.split(r"\s+", tl) if p]
    if len(parts) > 1:
        glued = "".join(parts)
        if glued in _SITE_NOISE or glued in _TECH_NOISE:
            return True
        useful = 0
        for p in parts:
            if p in _STOP_NOISE:
                continue
            if (
                p.isdigit()
                or _is_year_token(p)
                or _RES_TOKEN_RE.match(p)
                or _WEB_DL_RE.match(p)
                or p in _TECH_NOISE
                or p in _SITE_NOISE
                or re.fullmatch(r"\d+p?", p)
            ):
                return True
            useful += 1
        return useful < 2
    if tl.isdigit():
        return True
    if _is_year_token(tl):
        return True
    if _RES_TOKEN_RE.match(tl):
        return True
    if _WEB_DL_RE.match(tl):
        return True
    if tl in _TECH_NOISE or tl in _SITE_NOISE or tl in _STOP_NOISE:
        return True
    if re.fullmatch(r"\d+p?", tl):
        return True
    if re.fullmatch(r"[a-f0-9]{6,}", tl):
        return True
    return False


# Palavras de título que cortam sequências de nomes (não são performers).
_NAME_BREAK = frozenset(
    {
        "horny",
        "cant",
        "can't",
        "stop",
        "squirting",
        "squirt",
        "big",
        "cock",
        "dick",
        "fuck",
        "fucked",
        "fucking",
        "fucks",
        "love",
        "loves",
        "loving",
        "gets",
        "get",
        "takes",
        "take",
        "gives",
        "giving",
        "what",
        "she",
        "he",
        "her",
        "his",
        "him",
        "my",
        "your",
        "hard",
        "deep",
        "rough",
        "sexy",
        "hot",
        "wet",
        "tight",
        "first",
        "time",
        "scene",
        "trailer",
        "official",
        "new",
        "best",
        "compilation",
        "highlights",
    }
)


def _stem_raw_chunks(stem: str) -> list[str]:
    """Tokens crus do stem (minúsculas), sem filtrar — para montar nomes compostos."""
    s = stem
    s = re.sub(r"(?i)\bweb[\-_]?dl\b", " ", s)
    s = re.sub(r"(?i)\bweb[\-_]?rip\b", " ", s)
    s = re.sub(r"(?i)\bblu[\-_]?ray\b", " ", s)
    s = re.sub(r"[\[\]\(\)]+", " ", s)
    s = re.sub(r"[\\/]+", " ", s)
    out: list[str] = []
    for chunk in re.split(r"[\s._\-+]+", s):
        raw = chunk.strip()
        if not raw:
            continue
        low = raw.lower().strip(".-_/")
        if (
            not low
            or low in _SITE_NOISE
            or low in _TECH_NOISE
            or low.isdigit()
            or _is_year_token(low)
            or _RES_TOKEN_RE.match(low)
        ):
            continue
        if re.search(r"[a-z0-9][A-Z]", raw) or re.search(r"[A-Z]{2,}[a-z]", raw):
            # OnlyFans → only+fans: se a forma colada é site, ignora o chunk inteiro
            if low in _SITE_NOISE:
                continue
            parts = _split_stuck_titlecase_words(_split_camel_case_gap(raw))
            for p in re.split(r"\s+", parts):
                wl = p.strip().lower().strip(".-_/")
                if wl and wl not in _SITE_NOISE and wl not in _TECH_NOISE:
                    out.append(wl)
        else:
            out.append(low)
    return out


def _is_performer_token(w: str) -> bool:
    wl = w.strip().lower()
    if len(wl) < 2:
        return False
    if wl in _STOP_NOISE or wl == "and":
        return False
    if wl in _NAME_BREAK or wl in NAME_DUD_ANY or wl in NAME_DUD_MIDDLE:
        return False
    if wl in _TECH_NOISE or wl in _SITE_NOISE or wl in _CFG.garbage:
        return False
    if wl.isdigit() or _is_year_token(wl) or _RES_TOKEN_RE.match(wl):
        return False
    if not _has_vowel(wl):
        return False
    if any(c.isdigit() for c in wl):
        return False
    return True


def _extract_name_phrases(stem: str) -> set[str]:
    """
    Nomes compostos: «riley rae», «jack and jill».
    Usa «and» como cola; corta em ruído / palavras de título.
    """
    words = _stem_raw_chunks(stem)
    out: set[str] = set()
    i = 0
    while i < len(words):
        w = words[i]
        if not _is_performer_token(w):
            i += 1
            continue

        # jack and jill  /  a and b and c
        if (
            i + 2 < len(words)
            and words[i + 1] == "and"
            and _is_performer_token(words[i + 2])
        ):
            parts = [w]
            j = i
            while (
                j + 2 < len(words)
                and words[j + 1] == "and"
                and _is_performer_token(words[j + 2])
            ):
                parts.append(words[j + 2])
                j += 2
            if len(parts) >= 2:
                out.add(" and ".join(parts))
                i = j + 1
                continue

        # riley rae (dois nomes seguidos)
        if i + 1 < len(words) and _is_performer_token(words[i + 1]):
            out.add(f"{w} {words[i + 1]}")
            # trigram se o 3.º também for nome e não houver «and»
            if i + 2 < len(words) and _is_performer_token(words[i + 2]):
                out.add(f"{w} {words[i + 1]} {words[i + 2]}")
                i += 3
            else:
                i += 2
            continue

        i += 1
    return out


def _stem_word_tokens(stem: str) -> list[str]:
    """Parte o nome do ficheiro em palavras úteis (sem ruído de site/release)."""
    s = stem
    s = re.sub(r"(?i)\bweb[\-_]?dl\b", " ", s)
    s = re.sub(r"(?i)\bweb[\-_]?rip\b", " ", s)
    s = re.sub(r"(?i)\bblu[\-_]?ray\b", " ", s)
    s = re.sub(r"[\[\]\(\)]+", " ", s)
    s = re.sub(r"[\\/]+", " ", s)
    chunks = re.split(r"[\s._\-+]+", s)
    out: list[str] = []
    seen: set[str] = set()

    def add(w: str) -> None:
        wl = w.strip().lower().strip(".-_/")
        if not wl or wl in seen:
            return
        if _is_garbage_tag(wl) or wl in _CFG.garbage:
            return
        seen.add(wl)
        out.append(wl)

    for chunk in chunks:
        if not chunk:
            continue
        raw = chunk.strip()
        low = raw.lower().strip(".-_/")
        if _is_garbage_tag(low) or low in _CFG.garbage:
            continue
        if re.search(r"[a-z0-9][A-Z]", raw) or re.search(r"[A-Z]{2,}[a-z]", raw):
            add(low)
            parts = _split_stuck_titlecase_words(_split_camel_case_gap(raw))
            for p in re.split(r"\s+", parts):
                add(p)
        else:
            add(raw)
    return out


def filtrar_tags_redundantes(tags: set[str]) -> set[str]:
    """
    Evita a mesma palavra em tags diferentes no mesmo vídeo.
    Ex.: juke + juke box → juke, box (remove o composto).
    """
    s = {t.strip().lower() for t in tags if t and str(t).strip()}
    singles = {t for t in s if " " not in t}
    rm: set[str] = set()
    for t in s:
        if " " not in t:
            continue
        parts = [p for p in t.replace(" and ", " ").split() if p and p != "and"]
        if any(p in singles for p in parts):
            rm.add(t)
    s -= rm
    for stem in _CFG.needles:
        if stem not in s:
            continue
        rm = set()
        for x in s:
            if x == stem:
                continue
            if x.startswith(stem + " "):
                rm.add(x)
            elif " " not in x and x.startswith(stem) and len(x) > len(stem):
                rm.add(x)
        s -= rm
    return s


def _needle_matched_in_stem_lowercase(nome_lower: str, colada_sem_sep: str, needle_lc: str) -> bool:
    """Detecção da agulha no stem (minúsculas). Curtas ≤4 letras: só como token isolado (− computer, − women)."""
    n = needle_lc.strip().lower()
    if len(n) < 2:
        return False
    if len(n) <= 4:
        return bool(re.search(rf"(^|[^a-z0-9]){re.escape(n)}([^a-z0-9]|$)", nome_lower))
    n_strip = re.sub(r"[^a-z0-9]+", "", n)
    return n in nome_lower or (bool(n_strip) and n_strip in colada_sem_sep)


def _hits_needle_substrings(nome_base_lower: str) -> set[str]:
    """Agulhas da lista encontradas no nome → tags (prioridade máxima no filtro final)."""
    if not nome_base_lower:
        return set()
    colada = re.sub(r"[^a-z0-9]+", "", nome_base_lower)
    out: set[str] = set()
    for needle in _CFG.needles:
        n = needle.strip().lower()
        if len(n) < 2:
            continue
        if _needle_matched_in_stem_lowercase(nome_base_lower, colada, n):
            out.add(n)
    return out


def extrair_tags_genericas(nome_arquivo: str) -> str:
    """
    Auto-tags = todas as palavras úteis do nome do ficheiro.
    Exclui: números, anos, resoluções/codecs, xxx, P2P, sites (OnlyFans, …),
    stopwords curtas, e a lista garbage.json. Mantém agulhas do tags.json.
    """
    stem = os.path.splitext(nome_arquivo)[0]
    stem_lower = stem.lower()
    tags: set[str] = set()
    forced_hits = _hits_needle_substrings(stem_lower)

    for w in _stem_word_tokens(stem):
        if w in forced_hits or (w not in _CFG.garbage and not _is_garbage_tag(w)):
            tags.add(w)

    for m in re.finditer(r"\[([^\]]+)\]", stem):
        for part in re.split(r"[,;]+", m.group(1)):
            for w in _stem_word_tokens(part):
                if w in forced_hits or (w not in _CFG.garbage and not _is_garbage_tag(w)):
                    tags.add(w)

    for m in re.finditer(r"\(([^)]+)\)", stem):
        inner = m.group(1).strip()
        if not inner or _is_technical_paren(inner):
            continue
        for w in _stem_word_tokens(inner):
            if w in forced_hits or (w not in _CFG.garbage and not _is_garbage_tag(w)):
                tags.add(w)

    for p in PREFIXOS_NO_NOME:
        if p in stem_lower and (p in forced_hits or p not in _CFG.garbage):
            tags.add(p)

    for phrase in _extract_name_phrases(stem):
        if phrase in forced_hits or (phrase not in _CFG.garbage and not _is_garbage_tag(phrase)):
            tags.add(phrase)

    tags |= forced_hits
    tags = filtrar_tags_redundantes(tags)
    tags = {
        t
        for t in tags
        if t in forced_hits or (t not in _CFG.garbage and not _is_garbage_tag(t))
    }
    return ";".join(sorted(tags))


def folder_pair_tag_from_dirname(dir_name: str) -> str:
    """Duas primeiras palavras do nome da pasta (espaço ou ponto), uma única tag (mesmo casing relativo à pasta)."""
    parts = [p for p in re.split(r"[\s.]+", (dir_name or "").strip()) if p]
    if not parts:
        return ""
    return " ".join(parts[:2])


def _merge_tag_blobs(*blobs: str) -> str:
    seen: set[str] = set()
    for blob in blobs:
        for t in str(blob or "").split(";"):
            w = t.strip().lower()
            if w:
                seen.add(w)
    return ";".join(sorted(filtrar_tags_redundantes(seen)))


def _tags_for_trailer_file(file_name: str, parent_folder: str | None = None) -> str:
    """Tags do ficheiro + do nome da pasta (pontos = espaços), se houver subpasta."""
    parts: list[str] = [extrair_tags_genericas(file_name)]
    if parent_folder and parent_folder.strip():
        # Pasta tipo OnlyFans.2026.Riley.Rae… — trata como nome de ficheiro
        parts.append(extrair_tags_genericas(f"{parent_folder.strip()}.mp4"))
        fp = folder_pair_tag_from_dirname(parent_folder)
        if fp:
            parts.append(fp)
    return _merge_tag_blobs(*parts)


def _append_trailer_rows(
    dados: list[dict[str, str]],
    trailers_dir: str,
    *,
    rel_prefix: str | None = None,
) -> None:
    """Varre uma pasta trailers/ (ficheiros + 1 nível de subpasta)."""
    video_ext = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
    try:
        names = os.listdir(trailers_dir)
    except OSError:
        return
    for name in names:
        path = os.path.join(trailers_dir, name)
        if os.path.isfile(path) and name.lower().endswith(video_ext):
            rel = name if not rel_prefix else f"{rel_prefix}/{name}".replace("\\", "/")
            # Legado: rel_prefix é o nome da pasta-cena → também gera tags desse nome
            parent = rel_prefix if rel_prefix and "/" not in rel_prefix.replace("\\", "/") else None
            tags = _tags_for_trailer_file(name, parent)
            dados.append({"Arquivo": rel.replace("\\", "/"), "Tags": tags})
        elif os.path.isdir(path) and not name.startswith("."):
            try:
                subnames = os.listdir(path)
            except OSError:
                continue
            for fn in subnames:
                fp = os.path.join(path, fn)
                if not os.path.isfile(fp) or not fn.lower().endswith(video_ext):
                    continue
                rel_arq = f"{name}/{fn}".replace("\\", "/")
                if rel_prefix:
                    rel_arq = f"{rel_prefix}/{rel_arq}".replace("\\", "/")
                tags = _tags_for_trailer_file(fn, name)
                dados.append({"Arquivo": rel_arq, "Tags": tags})


def _append_legacy_scene_trailers(dados: list[dict[str, str]], library_root: str) -> None:
    """Compat catálogo: <cena>/trailers/ficheiro.mp4 → Arquivo «cena/ficheiro.mp4»."""
    skip = {"trailers", "preview", "shrinked", "edited", "bat-work", ".thumb_cache"}
    try:
        entries = os.listdir(library_root)
    except OSError:
        return
    for name in entries:
        if name.startswith(".") or name.lower() in skip:
            continue
        scene_dir = os.path.join(library_root, name)
        if not os.path.isdir(scene_dir):
            continue
        nested = os.path.join(scene_dir, "trailers")
        if not os.path.isdir(nested):
            continue
        _append_trailer_rows(dados, nested, rel_prefix=name)


def _safe_label_for_filename(label: str) -> str:
    """Evita caracteres inválidos no nome tags_<label>.csv no Windows."""
    bad = '<>:"/\\|?*'
    s = "".join("_" if c in bad else c for c in (label or "").strip())
    return s or "Tags_Automaticas"


def _safe_segment(seg: str) -> str:
    bad = '<>:"/\\|?*'
    return "".join("_" if c in bad else c for c in seg.strip())


def tree_relpath_to_label(tree: str) -> str:
    """zz_checking\\\\chica ou zz_checking/chica → zz_checking.chica (convenção árvore → nome CSV)."""
    parts = [p.strip() for p in re.split(r"[/\\]+", (tree or "").strip()) if p.strip()]
    safe = [_safe_segment(p) for p in parts if _safe_segment(p)]
    return ".".join(safe) if safe else "Tags_Automaticas"


def executar(
    scan_dir: str | None = None,
    label: str | None = None,
    tree_relpath: str | None = None,
    *,
    tags_json: str | None = None,
    garbage_json: str | None = None,
) -> None:
    reload_tag_cfg(tags_json=tags_json, garbage_json=garbage_json)

    diretorio = os.path.abspath(scan_dir or os.getcwd())
    if tree_relpath and str(tree_relpath).strip():
        pasta_nome = tree_relpath_to_label(str(tree_relpath))
    elif label and label.strip():
        pasta_nome = _safe_label_for_filename(label)
    else:
        pasta_nome = os.path.basename(os.path.normpath(diretorio)) or "Tags_Automaticas"

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    out_dir = os.path.join(project_root, "data", "file-lists")
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.isdir(diretorio):
        print(f"Pasta inexistente: {diretorio}")
        return

    dados: list[dict[str, str]] = []
    _append_trailer_rows(dados, diretorio)

    # Se --dir é …/trailers, inclui também …/<cena>/trailers (mesmo esquema do catálogo).
    base = os.path.basename(os.path.normpath(diretorio)).lower()
    if base == "trailers":
        library_root = os.path.dirname(diretorio)
        if library_root and os.path.isdir(library_root):
            before = len(dados)
            _append_legacy_scene_trailers(dados, library_root)
            added = len(dados) - before
            if added:
                print(f"[legado] +{added} trailer(s) em pastas <cena>/trailers/")

    # Dedup por Arquivo (preferir a 1.ª ocorrência)
    seen_files: set[str] = set()
    uniq: list[dict[str, str]] = []
    for row in dados:
        key = row["Arquivo"].replace("\\", "/").lower()
        if key in seen_files:
            continue
        seen_files.add(key)
        uniq.append(row)
    dados = uniq

    if not dados:
        print("Nenhum vídeo encontrado.")
        return

    df = pd.DataFrame(dados)
    out_file = os.path.join(out_dir, f"tags_{pasta_nome}.csv")
    df.to_csv(out_file, sep="|", index=False, encoding="utf-8-sig")
    print(f"Feito! CSV com tags limpas:\n  {out_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Gera data/file-lists/tags_<nome>.csv a partir dos nomes dos videos. "
            "Regras: data/tag-rules/tags.json (needles) e garbage.json por omissao."
        ),
    )
    parser.add_argument(
        "--dir",
        metavar="PASTA",
        help="Pasta onde estao os .mp4/.mkv (por omissao: directorio actual). Use trailers/ de cada biblioteca.",
    )
    parser.add_argument(
        "--label",
        metavar="ROTULO",
        help="Nome para o CSV (tags_<rotulo>.csv); por omissao usa o ultimo segmento de --dir.",
    )
    parser.add_argument(
        "--tree-relpath",
        metavar="CAMINHO",
        help="Árvore relativa ex. zz_checking/chica ou zz_checking\\\\chica -> tags_zz_checking.chica.csv (prioridade sobre --label).",
    )
    parser.add_argument(
        "--tags-json",
        metavar="PATH",
        help="Caminho para tags.json (por omissao: data/tag-rules/tags.json sob a raiz do projecto).",
        default=None,
    )
    parser.add_argument(
        "--garbage-json",
        metavar="PATH",
        help="Caminho para garbage.json - palavras excluidas (por omissao: data/tag-rules/garbage.json).",
        default=None,
    )
    args = parser.parse_args()
    executar(
        scan_dir=args.dir,
        label=args.label,
        tree_relpath=args.tree_relpath,
        tags_json=args.tags_json,
        garbage_json=args.garbage_json,
    )
