# وكالة البالة

## إرسال كشوفات الزبائن عبر واتساب

كشف الحساب يحتوي زرين:

- **فتح الكشف في واتساب:** يفتح واتساب على هاتف المستخدم مع الرسالة جاهزة، ولا يرسلها قبل ضغط المستخدم على إرسال.
- **إرسال تلقائي عبر واتساب:** يطلب تأكيدًا ورمزًا إداريًا ثم يستخدم WhatsApp Business Cloud API.

متغيرات الاستضافة المطلوبة للإرسال التلقائي:

```text
APP_ADMIN_PIN=<رمز إداري سري>
WHATSAPP_PHONE_NUMBER_ID=<رقم الهاتف التعريفي من Meta>
WHATSAPP_ACCESS_TOKEN=<رمز وصول دائم من Meta>
WHATSAPP_API_VERSION=<نسخة Graph API المفعلة في Meta>
```

للإرسال خارج نافذة خدمة الزبون، أضف قالب Utility معتمدًا يحتوي متغير نص واحد:

```text
WHATSAPP_TEMPLATE_NAME=<اسم القالب المعتمد>
WHATSAPP_TEMPLATE_LANGUAGE=ar
```

## النسخ الاحتياطي

الخدمة تنشئ نسخة JSON كاملة، تضغطها ثم تشفرها باستخدام AES-256-GCM. تحفظ نسخة يومية في bucket خاص داخل Supabase بعد الساعة 03:00 بتوقيت عمّان، وترفع نسخة يوم الأحد إلى Google Drive.

متغيرات الاستضافة المطلوبة:

```text
BACKUP_ENCRYPTION_KEY=<مفتاح Base64 بطول 32 بايت>
BACKUP_BUCKET=bale-backups
GOOGLE_SERVICE_ACCOUNT_JSON=<JSON خام أو Base64 لحساب خدمة Google>
GOOGLE_DRIVE_FOLDER_ID=<معرف مجلد النسخ في Google Drive>
```

يجب مشاركة مجلد Google Drive مع بريد حساب الخدمة بصلاحية **محرر**. لا تضع أي سر داخل ملفات المشروع أو GitHub.

فحص محلي سريع:

```bash
npm ci
npm test
```
