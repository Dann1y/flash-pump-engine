export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Flash Pump</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            pump: { 400: '#a3e635', 500: '#84cc16', 600: '#65a30d' },
          }
        }
      }
    }
  </script>
  <style>
    [hx-indicator] .htmx-indicator { display: none; }
    [hx-indicator].htmx-request .htmx-indicator { display: inline-block; }
    .htmx-settling { opacity: 0.8; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen">
  ${body}
</body>
</html>`;
}

export function nav(current: string): string {
  const links = [
    { href: "/", label: "Dashboard", id: "dashboard" },
    { href: "/tokens", label: "Tokens", id: "tokens" },
    { href: "/wallets", label: "Wallets", id: "wallets" },
  ];

  return `
  <nav class="bg-gray-900 border-b border-gray-800">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-14">
        <div class="flex items-center gap-6">
          <span class="text-pump-400 font-bold text-lg">Flash Pump</span>
          <div class="flex gap-1">
            ${links
              .map(
                (l) => `
              <a href="${l.href}"
                 class="px-3 py-2 rounded text-sm font-medium ${
                   current === l.id
                     ? "bg-gray-800 text-pump-400"
                     : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                 }">
                ${l.label}
              </a>`
              )
              .join("")}
          </div>
        </div>
        <a href="/logout" class="text-gray-500 hover:text-gray-300 text-sm">Logout</a>
      </div>
    </div>
  </nav>`;
}

export function card(title: string, content: string, extra = ""): string {
  return `
  <div class="bg-gray-900 rounded-lg border border-gray-800 p-5 ${extra}">
    <h3 class="text-sm font-medium text-gray-400 mb-3">${title}</h3>
    ${content}
  </div>`;
}

export function stat(label: string, value: string, sub = ""): string {
  return `
  <div>
    <p class="text-2xl font-bold text-gray-100">${value}</p>
    <p class="text-xs text-gray-500 mt-1">${label}</p>
    ${sub ? `<p class="text-xs text-gray-600 mt-0.5">${sub}</p>` : ""}
  </div>`;
}

export function badge(
  text: string,
  color: "green" | "yellow" | "red" | "blue" | "gray"
): string {
  const colors = {
    green: "bg-green-900/50 text-green-400 border-green-800",
    yellow: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
    red: "bg-red-900/50 text-red-400 border-red-800",
    blue: "bg-blue-900/50 text-blue-400 border-blue-800",
    gray: "bg-gray-800 text-gray-400 border-gray-700",
  };
  return `<span class="text-xs px-2 py-0.5 rounded border ${colors[color]}">${text}</span>`;
}

export function statusBadge(status: string): string {
  const map: Record<string, "green" | "yellow" | "red" | "blue" | "gray"> = {
    active: "green",
    deploying: "blue",
    exiting: "yellow",
    completed: "gray",
    failed: "red",
  };
  return badge(status, map[status] ?? "gray");
}

export function progressBar(pct: number): string {
  const color =
    pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-blue-500";
  return `
  <div class="w-full bg-gray-800 rounded-full h-2">
    <div class="${color} h-2 rounded-full transition-all" style="width: ${Math.min(pct, 100).toFixed(1)}%"></div>
  </div>`;
}
