import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'roast@yourdomain.com';

export async function sendRoastEmail(
  to: string,
  habitTitle: string,
  message: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `You missed "${habitTitle}" — time to face the music`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>HabitForge Accountability</title>
        </head>
        <body style="margin:0;padding:0;background-color:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f;padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
                  <tr>
                    <td style="padding:32px 40px 0;text-align:center;">
                      <p style="margin:0;font-size:28px;">🔥</p>
                      <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">HabitForge</h1>
                      <p style="margin:4px 0 0;color:#6b6b6b;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Accountability Report</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 40px;">
                      <div style="background-color:#242424;border-left:3px solid #ef4444;border-radius:6px;padding:20px 24px;">
                        <p style="margin:0 0 6px;font-size:11px;color:#ef4444;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Missed habit</p>
                        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${escapeHtml(habitTitle)}</p>
                      </div>
                      <div style="margin-top:24px;background-color:#242424;border-radius:6px;padding:20px 24px;">
                        <p style="margin:0;color:#d4d4d4;font-size:15px;line-height:1.7;">${escapeHtml(message)}</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 40px 32px;text-align:center;">
                      <p style="margin:0;color:#4b4b4b;font-size:12px;">You're receiving this because you enabled roast notifications in HabitForge.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  } catch (error: unknown) {
    console.error('[Email] Failed to send roast email to', to, ':', error);
  }
}

export async function sendWeeklySummaryEmail(
  to: string,
  message: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Your HabitForge Weekly Summary`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>HabitForge Weekly Summary</title>
        </head>
        <body style="margin:0;padding:0;background-color:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f0f;padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
                  <tr>
                    <td style="padding:32px 40px 0;text-align:center;">
                      <p style="margin:0;font-size:28px;">📊</p>
                      <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">HabitForge</h1>
                      <p style="margin:4px 0 0;color:#6b6b6b;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Weekly Summary</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 40px;">
                      <div style="background-color:#242424;border-left:3px solid #22c55e;border-radius:6px;padding:20px 24px;">
                        <p style="margin:0;color:#d4d4d4;font-size:15px;line-height:1.7;">${escapeHtml(message)}</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 40px 32px;text-align:center;">
                      <p style="margin:0;color:#4b4b4b;font-size:12px;">You're receiving this because you enabled weekly summaries in HabitForge.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  } catch (error: unknown) {
    console.error('[Email] Failed to send weekly summary email to', to, ':', error);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
