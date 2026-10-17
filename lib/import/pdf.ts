import { getDocumentProxy } from "unpdf";

/**
 * PDF → text lines, the input of lib/import/pdf-parse.ts. Server only: it pulls
 * in pdf.js.
 *
 * pdf.js hands out positioned text fragments, not lines. Fragments within
 * Y_TOLERANCE_PT of each other share a line; a horizontal gap wider than
 * COLUMN_GAP_PT becomes two spaces, which is what layout regexes anchor on to
 * tell table columns apart ("Merchant, Place CC␣␣150.00").
 */

const Y_TOLERANCE_PT = 2;
const COLUMN_GAP_PT = 4;

/** An expected failure with a message that can go straight to the user. */
export class PdfExtractError extends Error {}

interface Fragment {
  text: string;
  x: number;
  y: number;
  width: number;
}

export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new PdfExtractError("Das PDF ist passwortgeschützt.");
    }
    throw new PdfExtractError("Das PDF konnte nicht gelesen werden.");
  }

  try {
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      const fragments: Fragment[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        fragments.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      lines.push(...fragmentsToLines(fragments));
    }
    if (lines.length === 0) throw new PdfExtractError("PDF enthält keinen lesbaren Text (Scan?).");
    return lines;
  } catch (err) {
    // pdf.js errors are English; the user gets one German message.
    if (err instanceof PdfExtractError) throw err;
    throw new PdfExtractError("Das PDF konnte nicht gelesen werden.");
  } finally {
    // The document proxy itself has no destroy(); its loading task does.
    // A failing cleanup must not mask the result (or the real error).
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

function fragmentsToLines(fragments: Fragment[]): string[] {
  const rows: { y: number; items: Fragment[] }[] = [];
  for (const fragment of fragments) {
    const row = rows.find((candidate) => Math.abs(candidate.y - fragment.y) <= Y_TOLERANCE_PT);
    if (row) row.items.push(fragment);
    else rows.push({ y: fragment.y, items: [fragment] });
  }
  // PDF y grows upwards, so the top of the page has the largest y.
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = "";
    let end: number | null = null;
    for (const item of row.items) {
      if (end !== null) {
        if (item.x - end > COLUMN_GAP_PT) line += "  ";
        else if (!item.text.startsWith(" ")) line += " ";
      }
      line += item.text;
      end = item.x + item.width;
    }
    return line.trim();
  });
}
