import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './en.json';
import arTranslations from './ar.json';

i18n
  .use(LanguageDetector) // عشان يلقط لغة المتصفح تلقائي
  .use(initReactI18next) // عشان يربط مع React
  .init({
    resources: {
      en: { translation: enTranslations },
      ar: { translation: arTranslations }
    },
    fallbackLng: 'en', // اللغة الافتراضية لو حصلت مشكلة
    interpolation: {
      escapeValue: false // React بيحمي الكود تلقائياً
    }
  });

export default i18n;