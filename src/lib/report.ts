/** 利用者への通知。error が true なら消えない赤い通知、false なら数秒で消える通知として表示する。 */
export type Report = (message: string, error?: boolean) => void;
