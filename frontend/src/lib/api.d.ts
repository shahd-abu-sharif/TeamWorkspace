export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
    skipAuth?: boolean;
    raw?: boolean;
}

export class ApiError extends Error {
    status: number;
    issues?: unknown;

    constructor(status: number, message: string, issues?: unknown);
}

export function api<T = unknown>(
    path: string,
    options?: ApiRequestOptions & { body?: unknown },
): Promise<T>;

export function setAccessToken(token: string | null): void;
export function getAccessToken(): string | null;
export function setActiveWorkspace(id: string | null): void;

export const apiClient: {
    get<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
    post<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;
    delete<T = void>(path: string, options?: ApiRequestOptions): Promise<T>;
    upload<T = unknown>(
        path: string,
        file: File,
        onProgress?: (progress: number) => void,
    ): Promise<T>;
};
