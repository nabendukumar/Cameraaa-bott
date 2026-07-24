import { Router, type IRouter } from "express";
import healthRouter from "./health";
import captureRouter from "./capture";

const router: IRouter = Router();

router.use(healthRouter);
router.use(captureRouter);

export default router;
