import { layout } from "./layout";

export function loginPage(error?: string): string {
  return layout(
    "Login",
    `
    <div class="min-h-screen flex items-center justify-center">
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 w-full max-w-sm">
        <h1 class="text-xl font-bold text-pump-400 mb-6 text-center">Flash Pump</h1>
        ${error ? `<p class="text-red-400 text-sm mb-4 text-center">${error}</p>` : ""}
        <form method="POST" action="/login">
          <label class="block text-sm text-gray-400 mb-2">Password</label>
          <input
            type="password"
            name="password"
            autofocus
            required
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-pump-500 mb-4"
            placeholder="Enter dashboard password"
          />
          <button
            type="submit"
            class="w-full bg-pump-600 hover:bg-pump-500 text-white font-medium py-2 rounded transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    </div>`
  );
}
