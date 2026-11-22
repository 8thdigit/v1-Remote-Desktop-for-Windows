import { Router, type IRouter } from "express";
import healthRouter from "./health";
import msfwrRouter from "./msfwr";
import authRouter from "./auth";
import adminRouter from "./admin";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/billing", billingRouter);
router.use("/msfwr", msfwrRouter);

export default router;
