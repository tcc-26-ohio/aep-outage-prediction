export type Assessment = {
  premise: string;
  location: string;
  circuit: string;
  risk: string;
  window: string;
  drivers: string[];
  restoration: string;
  preparation: string[];
  eligible: boolean;
  demo: boolean;
};

export function apiUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(`/api${path}`), init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const getAssessment = (premise: string) =>
  request<Assessment>(`/assessments/${encodeURIComponent(premise)}`);

export const subscribe = (premise: string, email: string, consent: boolean) =>
  request<{ message: string }>("/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ premise, email, consent }),
  });
