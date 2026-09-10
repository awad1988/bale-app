module.exports = function registerWhatsAppRoutes(ctx) {
  const app = ctx.app;

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = '962' + digits.slice(1);
    if (digits && !digits.startsWith('962') && digits.length <= 9) digits = '962' + digits;
    return digits;
  }

  function requireAdminPin(req) {
    const configured = String(process.env.APP_ADMIN_PIN || '');
    if (!configured) throw new Error('أضف APP_ADMIN_PIN في إعدادات الاستضافة قبل تفعيل الإرسال التلقائي.');
    if (String(req.get('x-admin-pin') || '') !== configured) throw new Error('رمز التأكيد الإداري غير صحيح.');
  }

  app.get('/api/v7/whatsapp/status', (_req, res) => {
    res.json({
      configured: Boolean(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_API_VERSION &&
        process.env.APP_ADMIN_PIN
      )
    });
  });

  app.post('/api/v7/whatsapp/send', async (req, res) => {
    try {
      requireAdminPin(req);
      if (req.body?.confirmation !== 'SEND-CONFIRMED') throw new Error('يجب تأكيد الإرسال من داخل التطبيق.');

      const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
      const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
      const apiVersion = String(process.env.WHATSAPP_API_VERSION || '').trim();
      const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
      const templateLanguage = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar').trim();
      if (!phoneNumberId || !accessToken || !apiVersion) {
        throw new Error('ربط WhatsApp Business غير مكتمل في إعدادات الاستضافة.');
      }

      const to = normalizePhone(req.body?.phone);
      const message = String(req.body?.message || '').trim();
      if (!/^9627\d{8}$/.test(to)) throw new Error('رقم واتساب غير صالح. استخدم رقمًا أردنيًا صحيحًا.');
      if (!message) throw new Error('كشف الحساب فارغ.');
      if (message.length > 4096) throw new Error('كشف الحساب طويل جدًا للإرسال برسالة واحدة.');

      const payload = templateName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
              name: templateName,
              language: { code: templateLanguage },
              components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }]
            }
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: message }
          };

      const response = await fetch(
        `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `WhatsApp error ${response.status}`);
      res.json({ ok: true, message_id: body?.messages?.[0]?.id || null });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
};
