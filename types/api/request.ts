import type { Request } from "express";

type EmptyObject = Record<string, never>;

export type RequestWithBody<T> = Request<EmptyObject, EmptyObject, T, EmptyObject>;

export type RequestWithQuery<T> = Request<EmptyObject, EmptyObject, EmptyObject, T>;
