import { Router, type IRouter } from "express";
import healthRouter from "./health";
import desklineRouter from "./deskline";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/deskline", desklineRouter);

export default router;
