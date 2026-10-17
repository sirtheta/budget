/**
 * Builds a minimal PDF with positioned Helvetica text, so extraction tests need
 * no binary fixtures (and no real statement with real card numbers).
 *
 * ASCII only: the font has no encoding table.
 */
export interface PdfText {
  x: number;
  y: number;
  text: string;
}

function escapePdfText(text: string): string {
  return text.replace(/[()\\]/g, (char) => `\\${char}`);
}

export function buildTextPdf(pages: PdfText[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add("");
  const pagesObject = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: string[] = [];

  for (const items of pages) {
    const stream = items
      .map((item) => `BT /F1 10 Tf ${item.x} ${item.y} Td (${escapePdfText(item.text)}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`
    );
    kids.push(`${page} 0 R`);
  }
  objects[catalog - 1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
