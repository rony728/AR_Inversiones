declare global {
  namespace Express {
    interface Request {
      user?: { id: string; usuario: string };
    }
  }
}
export {};
