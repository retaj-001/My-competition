# خُطى — لوحة المراقبة المباشرة

تعرض هذه الصفحة آخر قراءة حقيقية من جهاز `khuta-esp32` في PostgreSQL على Supabase. بقي `app.js` وإعداد Firebase في المستودع كمسار رجوع مؤقت، بينما يستخدم الموقع المنشور `app.supabase.js`.

## السلوك

- تستعلم الصفحة عن `latest_public_reading` كل ثانيتين وتُحدّث المؤشرات دون إعادة تحميل.
- تُعرض «غير متاح» للحقول المفقودة أو null.
- تصبح القراءة «قديمة» إذا مضى أكثر من 10 ثوانٍ على timestamp الخادم، مع إبقاء آخر قيمة ظاهرة بوضوح.
- لا توجد بيانات أو رسوم عشوائية. الرسم التفصيلي مبني فقط من القراءات الحقيقية المستلمة منذ فتح الصفحة.
- إحداثيات GPS لا تظهر إلا عند توفر خط العرض والطول، ويظهر عندها رابط OpenStreetMap.

## الخصوصية والأمان

- القراءة العامة تحجب الإحداثيات الدقيقة في PostgreSQL نفسه.
- `latest_authorized_reading` يعيد الإحداثيات فقط لمستخدم مرتبط بالجهاز في `device_viewers`.
- لا يملك عميل المتصفح صلاحية إدخال أو تعديل القراءات.
- مفتاح Supabase الموجود في `supabase-config.public.js` مفتاح نشر عام ومقيّد بواسطة RLS، وليس Service Role.

## الرجوع إلى Firebase

لا تزال ملفات Firebase محفوظة. للرجوع المؤقت غيّر آخر وسم script في `index.html` من `app.supabase.js` إلى `app.js`.

لقواعد Firebase القديمة:

```powershell
firebase deploy --only database --project khuta-live-monitor
```

## النشر

GitHub Pages ينشر الفرع `main` من هذا المستودع. بعد دفع التغييرات، افتح:

https://retaj-001.github.io/My-competition/
