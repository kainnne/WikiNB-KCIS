import { connect } from "cloudflare:sockets";
import { Buffer } from "node:buffer";
export async function sendCodeEmail(env, email, code) {
  const socket = connect(
      { hostname: env.SMTP_HOST || "smtp.gmail.com", port: 465 },
      { secureTransport: "on" },
    ),
    reader = socket.readable.getReader(),
    writer = socket.writable.getWriter(),
    decoder = new TextDecoder();
  let buffer = "";
  const timer = setTimeout(() => socket.close(), 25000);
  async function reply(expected) {
    let lines = [];
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        const { done, value } = await reader.read();
        if (done) throw Error("Mail connection closed.");
        buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        const status = Number(line.slice(0, 3));
        if (!expected.includes(status))
          throw Error("Mail server rejected the request (" + status + ").");
        return;
      }
    }
  }
  async function command(value, expected) {
    await writer.write(new TextEncoder().encode(value + "\r\n"));
    await reply(expected);
  }
  try {
    await reply([220]);
    await command("EHLO kcis-ai.kainnne.com", [250]);
    await command("AUTH LOGIN", [334]);
    await command(Buffer.from(env.SMTP_USER || "").toString("base64"), [334]);
    await command(
      Buffer.from(String(env.SMTP_PASS || "").replace(/\s/g, "")).toString(
        "base64",
      ),
      [235],
    );
    const from = env.SMTP_FROM || "KCIS AI <ryanzhu@kainnne.com>",
      address = from.match(/<([^>]+)>/)?.[1] || from;
    if (/[\r\n]/.test(from + email)) throw Error("Invalid sender.");
    await command("MAIL FROM:<" + address + ">", [250]);
    await command("RCPT TO:<" + email + ">", [250, 251]);
    await command("DATA", [354]);
    const subject =
        "=?UTF-8?B?" +
        Buffer.from("KCIS AI 登入驗證碼").toString("base64") +
        "?=",
      text =
        "KCIS AI 登入驗證碼：" +
        code +
        "\n\n驗證碼於 10 分鐘後失效。若非本人操作，請忽略此郵件。",
      body = Buffer.from(text)
        .toString("base64")
        .match(/.{1,76}/g)
        .join("\r\n");
    await command(
      "From: " +
        from +
        "\r\nTo: " +
        email +
        "\r\nSubject: " +
        subject +
        "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
        body +
        "\r\n.",
      [250],
    );
    await command("QUIT", [221]);
    return { sent: true };
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => {});
  }
}
