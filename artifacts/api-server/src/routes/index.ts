import { Router, type IRouter } from "express";
import healthRouter from "./health";
import desklineRouter from "./deskline";
import authRouter from "./auth";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/deskline", desklineRouter);

export default router;
