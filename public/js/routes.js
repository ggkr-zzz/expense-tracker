// Hash routes: "#/", "#/expenses", "#/add", "#/edit/<id>".

const EDIT = /^\/edit\/([1-9]\d{0,14})$/;

/** location.hash -> { name: "dashboard" | "expenses" | "form" | "not-found", id? } */
export function parseRoute(hash) {
  const path = String(hash ?? "").replace(/^#/, "") || "/";
  if (path === "/") return { name: "dashboard" };
  if (path === "/expenses") return { name: "expenses" };
  if (path === "/add") return { name: "form", id: null };
  const edit = EDIT.exec(path);
  if (edit) return { name: "form", id: Number(edit[1]) };
  return { name: "not-found" };
}
