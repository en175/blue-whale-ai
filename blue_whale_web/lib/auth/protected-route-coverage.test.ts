import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { isPublicRoute } from "@/lib/auth/public-routes";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const apiRoot = path.join(webRoot, "app/api");

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".worker-dist",
  "node_modules",
  "out",
]);
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const INTERNAL_SERVICE_ROUTE_AUTH = new Map([
  [
    "internal/agent-model/v1/chat/completions/route.ts",
    ["AGENT_SERVICE_TOKEN", "x-agent-service-token", "bwcap_"],
  ],
]);

function walkFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const filePath = path.join(directory, entry);
      if (statSync(filePath).isDirectory()) {
        return SKIPPED_DIRECTORIES.has(entry) ? [] : walkFiles(filePath);
      }
      return [filePath];
    })
    .sort();
}

function hasProtectedRouteAuth(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "route.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importsWithAuthenticatedUser = false;
  let hasUnsupportedHttpExport = false;
  const exportedHttpMethods: ts.FunctionDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@/lib/auth/product-route-auth" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (element) =>
          (element.name.text === "withAuthenticatedUser" ||
            element.name.text === "withAdminUser") &&
          (element.propertyName?.text ?? element.name.text) ===
            element.name.text,
      )
    ) {
      importsWithAuthenticatedUser = true;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      HTTP_METHODS.has(node.name.text) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      exportedHttpMethods.push(node);
    }

    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text),
      )
    ) {
      hasUnsupportedHttpExport = true;
    }

    if (
      ts.isExportDeclaration(node) &&
      (node.exportClause === undefined ||
        (ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some((element) =>
            HTTP_METHODS.has(element.name.text),
          )))
    ) {
      hasUnsupportedHttpExport = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return (
    importsWithAuthenticatedUser &&
    !hasUnsupportedHttpExport &&
    exportedHttpMethods.length > 0 &&
    exportedHttpMethods.every((method) =>
      method.body?.statements.some(
        (statement) =>
          ts.isReturnStatement(statement) &&
          statement.expression !== undefined &&
          ts.isCallExpression(statement.expression) &&
          ts.isIdentifier(statement.expression.expression) &&
          (statement.expression.expression.text === "withAuthenticatedUser" ||
            statement.expression.expression.text === "withAdminUser"),
      ),
    )
  );
}

function hasInternalServiceRouteAuth(relativePath: string, source: string): boolean {
  const requiredMarkers = INTERNAL_SERVICE_ROUTE_AUTH.get(relativePath);
  return requiredMarkers !== undefined && requiredMarkers.every((marker) => source.includes(marker));
}

describe("protected product route coverage", () => {
  it("rejects a route that imports withAuthenticatedUser without calling it", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET() {",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("rejects a multi-method route when any exported method bypasses auth", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET(request: Request) {",
      "  return withAuthenticatedUser(request, async () => Response.json({}));",
      "}",
      "",
      "export async function POST() {",
      '  return Response.json({ error: "unprotected" });',
      "}",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("rejects an unprotected HTTP method exported as a const", () => {
    const source = [
      'import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";',
      "",
      "export async function GET(request: Request) {",
      "  return withAuthenticatedUser(request, async () => Response.json({}));",
      "}",
      "",
      "export const POST = async () => Response.json({});",
    ].join("\n");
    expect(hasProtectedRouteAuth(source)).toBe(false);
  });

  it("requires the internal agent model proxy to keep service and capability authentication", () => {
    const route = "internal/agent-model/v1/chat/completions/route.ts";
    const source = readFileSync(path.join(apiRoot, route), "utf8");

    expect(hasInternalServiceRouteAuth(route, source)).toBe(true);
    expect(hasInternalServiceRouteAuth(route, source.replace("bwcap_", ""))).toBe(false);
  });

  it("requires every non-exempt API route to use withAuthenticatedUser", () => {
    const uncovered = walkFiles(apiRoot)
      .filter((filePath) => filePath.endsWith("/route.ts"))
      .map((filePath) => ({
        filePath,
        relativePath: path.relative(apiRoot, filePath),
        source: readFileSync(filePath, "utf8"),
      }))
      .filter(({ relativePath }) => !isPublicRoute(relativePath))
      .filter(
        ({ relativePath, source }) =>
          !hasProtectedRouteAuth(source) &&
          !hasInternalServiceRouteAuth(relativePath, source),
      )
      .map(({ relativePath }) => relativePath);

    expect(uncovered).toEqual([]);
  });

  it("forbids legacy request identity helpers in production TypeScript", () => {
    const violations = walkFiles(webRoot)
      .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath))
      .filter((filePath) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return ["getUser" + "IdFromRequest", "ownerIdFrom" + "NewApiToken"]
          .filter((symbol) => source.includes(symbol))
          .map((symbol) => `${path.relative(webRoot, filePath)}: ${symbol}`);
      });

    expect(violations).toEqual([]);
  });

  it("forbids any Java gateway rewrite and GATEWAY_URL wiring (IK50GB 断链)", () => {
    const nextConfig = readFileSync(
      path.join(webRoot, "next.config.ts"),
      "utf8",
    );
    const dockerfile = readFileSync(path.join(webRoot, "Dockerfile"), "utf8");
    const javaRewriteSources = [
      // B 已退役：Conversation / GenerationInbox / AgentRun / InputRequest / SSE
      "/api/agent/runs/",
      "/api/generation-inbox/",
      "/api/jobs/:path*/stream",
      "/api/projects/:path*/conversation/",
      "/api/projects/:path*/input-requests/",
      "/api/projects/:path*/events",
      // C 断链：账户 / 回调 / Asset 文件代理（生产零消费者，均已迁 Node 或退役）
      "/api/user/:path*",
      "/api/webhooks/:path*",
      "/assets/:path*",
    ];

    expect(
      javaRewriteSources.filter((pattern) => nextConfig.includes(pattern)),
    ).toEqual([]);
    // §6.4.1：浏览器与 Next.js 不得再注入或请求 Java 网关地址。
    expect(nextConfig).not.toContain("process.env.GATEWAY_URL");
    expect(dockerfile).not.toContain("GATEWAY_URL");
    expect(dockerfile).not.toContain("blue-whale-gateway");
  });
});
