import { JWT } from "google-auth-library";
import { JSON_CONTENT_TYPE } from "./const.js";
import { gridSize, valuesRange } from "./csv.js";
import { withFetchTimeout } from "./fetch-with-timeout.js";
import { formatHttpErrorDetail } from "./sanitize-error.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

async function readJson(response) {
  const text = await response.text();
  const payload = text === "" ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`Sheets API ${formatHttpErrorDetail(response.status, text, response.statusText)}`);
  }
  return payload;
}

export function createSheetsClient({ serviceAccount, authClient, fetchImpl = fetch }) {
  const auth =
    authClient ??
    new JWT({
      email: serviceAccount?.client_email,
      key: serviceAccount?.private_key,
      scopes: [SHEETS_SCOPE],
    });

  async function request(url, options = {}) {
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
    async listSheetTitles(spreadsheetId) {
      const url = `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`;
      const payload = await readJson(await request(url));
      return (payload.sheets ?? [])
        .map((sheet) => sheet.properties?.title)
        .filter((title) => typeof title === "string");
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
