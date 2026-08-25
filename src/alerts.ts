import type { PendingAlertRow, StatusConfig } from "./schema.ts";

export interface StatusAlert extends PendingAlertRow {
  readonly group: string;
  readonly name: string;
  readonly url: string;
}

export const shouldAlert = (
  previous: 0 | 1 | undefined,
  current: 0 | 1,
): boolean => (current === 0 ? previous !== 0 : previous === 0);

export const makeAlertEmail = ({
  alert,
  siteName,
  statusUrl,
}: {
  readonly alert: StatusAlert;
  readonly siteName: string;
  readonly statusUrl?: string;
}) => {
  const outage = alert.ok === 0;
  const state = outage ? "OUTAGE" : "RECOVERED";
  const status = outage ? "experiencing an outage" : "operational again";
  const checkedAt = new Date(alert.created_at).toISOString();
  const lines = [
    `${alert.name} is ${status}.`,
    "",
    `Group: ${alert.group}`,
    `Service: ${alert.url}`,
    `Checked: ${checkedAt}`,
  ];
  if (statusUrl) lines.push(`Status page: ${statusUrl}`);
  return {
    subject: `[${siteName}] ${state}: ${alert.name}`,
    text: lines.join("\n"),
  };
};

export const statusPageUrl = (config: StatusConfig): string | undefined =>
  config.domain ? `https://${config.domain}` : undefined;
