import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher({ compact = false }) {
  const { i18n } = useTranslation();

  const toggle = () => {
    const next = i18n.language === 'ar' ? 'en' : 'ar';
    void i18n.changeLanguage(next);
  };

  const label = i18n.language === 'ar' ? 'English' : 'العربية';

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      title={label}
      aria-label={label}
    >
      <Languages className="size-3.5" />
      {!compact && <span>{label}</span>}
    </button>
  );
}
