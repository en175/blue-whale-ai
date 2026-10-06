import ts from "typescript";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { filename, source } = JSON.parse(input);
const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
if (file.parseDiagnostics.length) {
  throw new Error(ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, "\n"));
}
const opaque = [];
function visit(node) {
  if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node) ||
      node.kind === ts.SyntaxKind.JsxText || ts.isTemplateLiteralToken(node)) {
    opaque.push([node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(file), node.end]);
    return;
  }
  for (const child of node.getChildren(file)) visit(child);
}
visit(file);
opaque.sort((a, b) => a[0] - b[0]);
const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
const comments = [];
let range = 0;
while (scanner.getTextPos() < source.length) {
  const position = scanner.getTextPos();
  while (range < opaque.length && opaque[range][1] <= position) range++;
  if (range < opaque.length && opaque[range][0] <= position) {
    scanner.setTextPos(opaque[range][1]);
    continue;
  }
  const kind = scanner.scan();
  if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
    comments.push({
      start: file.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1,
      end: file.getLineAndCharacterOfPosition(scanner.getTextPos() - 1).line + 1,
      text: scanner.getTokenText(),
    });
  }
}
process.stdout.write(JSON.stringify(comments));
