export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; message: string };

export function actionSuccess<T = undefined>(data?: T): ActionResult<T> {
  return { success: true, data: data as T };
}

export function actionError(message: string): ActionResult<never> {
  return { success: false, message };
}
