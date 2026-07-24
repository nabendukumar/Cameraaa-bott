import { Router, type IRouter } from "express";
import healthRouter from "./health";
import captureRouter from "./capture";
import audioRouter from "./audio";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(captureRouter);
router.use(audioRouter);
router.use(telegramRouter);

export default router;
