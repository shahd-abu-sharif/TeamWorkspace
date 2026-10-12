
import { createContext, useContext, useLayoutEffect, useState } from 'react';
const ThemeContext = createContext({
    theme: 'light',
    toggle: () => { },
});

export function ThemeProvider({ children }) {
    const [theme] = useState('light');

    useLayoutEffect(() => {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('tth_theme', 'light');
    }, []);

    return (
        <ThemeContext.Provider
            value={{ theme, toggle: () => {} }}
        >
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
