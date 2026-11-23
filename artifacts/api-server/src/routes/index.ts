import { Router, type IRouter } from "express";
import healthRouter from "./health";
import msfwrRouter from "./msfwr";
import authRouter from "./auth";
import adminRouter from "./admin";
import billingRouter from "./billing";
import siteRouter from "./site";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/billing", billingRouter);
router.use("/site", siteRouter);
router.use("/msfwr", msfwrRouter);

export default router;
