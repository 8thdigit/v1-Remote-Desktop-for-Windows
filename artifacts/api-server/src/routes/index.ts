import { Router, type IRouter } from "express";
import healthRouter from "./health";
import msfwrRouter from "./msfwr";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/msfwr", msfwrRouter);

export default router;
