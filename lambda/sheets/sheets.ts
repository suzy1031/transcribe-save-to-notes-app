import { JWT } from "google-auth-library";
import { JSON_CONTENT_TYPE } from "../shared/const.ts";
import { gridSize, valuesRange } from "../csv/csv.ts";
import { withFetchTimeout } from "../shared/fetch-with-timeout.ts";
import { formatHttpErrorDetail } from "../shared/sanitize-error.ts";
import type { AuthClientLike, GoogleServiceAccount } from "../drive/types/drive.ts";
import type { SheetsClient } from "./types/sheets.ts";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  const payload = text === "" ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`Sheets API ${formatHttpErrorDetail(response.status, text, response.statusText)}`);
  }
  return payload;
}

export function createSheetsClient({
  serviceAccount,
  authClient,
  fetchImpl = fetch,
}: {
  serviceAccount?: GoogleServiceAccount;
  authClient?: AuthClientLike;
  fetchImpl?: typeof fetch;
}): SheetsClient {
  const auth: AuthClientLike =
    authClient ??
    new JWT({
      email: serviceAccount?.client_email,
      key: serviceAccount?.private_key,
      scopes: [SHEETS_SCOPE],
    });

  async function request(url: string, options: RequestInit = {}): Promise<Response> {
    const access = await auth.getAccessToken();
    const token = typeof access === "string" ? access : access?.token;
    if (!token) throw new Error("Google access token was empty");
    return fetchImpl(
      url,
      withFetchTimeout({
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.body ? { "content-type": JSON_CONTENT_TYPE } : {}),
          ...options.headers,
        },
      }),
    );
  }

  return {
    async listSheetTitles(spreadsheetId: string) {
      const url = `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`;
      const payload = await readJson(await request(url));
      return (payload.sheets ?? [])
        .map((sheet: any) => sheet.properties?.title)
        .filter((title: unknown): title is string => typeof title === "string");
    },

    async addSheetWithValues({ spreadsheetId, title, rows }) {
      const { rowCount, columnCount } = gridSize(rows);
      const created = await readJson(
        await request(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title,
                    gridProperties: { rowCount, columnCount },
                  },
                },
              },
            ],
          }),
        }),
      );
      const sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
      try {
        const range = encodeURIComponent(valuesRange(title));
        await readJson(
          await request(
            `${SHEETS_API}/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
            {
              method: "PUT",
              body: JSON.stringify({ values: rows }),
            },
          ),
        );
      } catch (error) {
        if (typeof sheetId === "number") {
          await readJson(
            await request(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({
                requests: [{ deleteSheet: { sheetId } }],
              }),
            }),
          ).catch(() => {});
        }
        throw error;
      }
    },
  };
}
