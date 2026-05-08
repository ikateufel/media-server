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
    """Remove palavras soltas que já aparecem dentro de uma tag composta (ex.: julia, ann → julia ann)."""
    words_in_multi = set()
    for t in tags:
        if " " in t:
            for w in t.split():
                if len(w) >= 2:
                    words_in_multi.add(w.lower())
    out: set[str] = set()
    for t in tags:
        if " " in t:
            out.add(t)
        elif t.lower() not in words_in_multi:
            out.add(t)
    return out


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


def _is_technical_paren(inner: str) -> bool:
    """True se o conteúdo entre parênteses for só ano / codec / resolução."""
    low = inner.lower()
    if _is_year_token(inner):
        return True
    if re.search(r"\b(1080p|720p|480p|2160p|4k|uhd|hevc|h\.?264|h\.?265|x264|x265|webrip|bluray)\b", low):
        return True
    if re.fullmatch(r"[\d\s.pkxhvecu\-]+", low) and len(low) <= 32:
        return True
    return False


def _is_garbage_tag(t: str) -> bool:
    tl = t.strip().lower()
    if len(tl) < 2:
        return True
    if _is_year_token(tl):
        return True
    if re.search(r"\b(1080p|720p|480p|2160p|4k|uhd|hevc|h264|h265|x264|x265)\b", tl):
        return True
    if tl in {"xxx", "hd", "sd", "fhd"}:
        return True
    return False


def filtrar_tags_redundantes(tags: set[str]) -> set[str]:
    s = {t.strip().lower() for t in tags if t and str(t).strip()}
    for stem in _CFG.needles:
        if stem not in s:
            continue
        rm: set[str] = set()
        for x in s:
            if x == stem:
                continue
            if x.startswith(stem + " "):
                rm.add(x)
            elif x.startswith(stem) and len(x) > len(stem):
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
    Prioridade: (1) tags em [colchetes]; (2) nomes em (parênteses) que não sejam ano/codec;
    (3) palavras curtas antes do primeiro [ (ex.: buc cor); (4) heurística Title Case + PREFIXOS_NO_NOME;
    (5) agulhas do JSON needles no nome (+ dedupe por prefixo) — não removidas por «garbage».
    """
    stem = os.path.splitext(nome_arquivo)[0]
    stem_lower = stem.lower()
    tags: set[str] = set()
    forced_hits = _hits_needle_substrings(stem_lower)

    # 1) [Brazzers]  [GhostFreakXX]  — vírgula ou ponto e vírgula separam várias tags no mesmo bloco
    for m in re.finditer(r"\[([^\]]+)\]", stem):
        inner = m.group(1)
        for part in re.split(r"[,;]+", inner):
            t = part.strip().lower()
            t = re.sub(r"\s+", " ", t)
            if len(t) >= 2 and (t not in _CFG.garbage or t in forced_hits) and not _is_garbage_tag(t):
                tags.add(t)

    # 2) (Sophie Dee)  — ignora (2009), (1080p HEVC), etc.
    for m in re.finditer(r"\(([^)]+)\)", stem):
        inner = m.group(1).strip()
        if not inner or _is_technical_paren(inner):
            continue
        t = re.sub(r"\s+", " ", inner.lower())
        if len(t) >= 2 and (t not in _CFG.garbage or t in forced_hits) and not _is_garbage_tag(t):
            tags.add(t)

    # 3) Prefixo antes do primeiro '[' — ex.: "buc cor [Brazzers]..."
    # Só se o segmento for claramente «tags curtas em minúsculas»; títulos Title Case
    # passam só pelo extrair_nomes_titlecase_do_titulo (evita julia/ann soltas no stem).
    first_br = stem.find("[")
    head = stem[:first_br] if first_br >= 0 else stem
    head = re.sub(r"\([^)]*\)", " ", head)
    head = re.sub(r"\[[^\]]*\]", " ", head)
    head_for_case = re.sub(r"[^A-Za-z]", "", head)
    if head_for_case and head_for_case.islower():
        for raw in head.replace(".", " ").replace("_", " ").split():
            wl = raw.strip("._-").lower()
            if len(wl) < 2 or (wl in _CFG.garbage and wl not in forced_hits) or _is_year_token(wl) or wl.isdigit():
                continue
            tags.add(wl)

    for p in PREFIXOS_NO_NOME:
        if p in stem_lower:
            tags.add(p)

    tags |= extrair_nomes_titlecase_do_titulo(stem)

    tags |= forced_hits

    tags = _dedupe_singles_absorvidos_em_compostos(tags)
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

    video_ext = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
    dados: list[dict[str, str]] = []

    for name in os.listdir(diretorio):
        path = os.path.join(diretorio, name)
        if os.path.isfile(path) and name.lower().endswith(video_ext):
            tags = extrair_tags_genericas(name)
            dados.append({"Arquivo": name, "Tags": tags})
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
                gen = extrair_tags_genericas(fn)
                fp_tag = folder_pair_tag_from_dirname(name)
                if fp_tag:
                    tags = f"{fp_tag};{gen}" if gen else fp_tag
                else:
                    tags = gen
                dados.append({"Arquivo": rel_arq, "Tags": tags})

    if not dados:
        print("Nenhum vídeo encontrado.")
        return

    df = pd.DataFrame(dados)
    # Nome alinhado com tag-import-file-lists.ts (tags_<rotulo_sessao>.csv)
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
