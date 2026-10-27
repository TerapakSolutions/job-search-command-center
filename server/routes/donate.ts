import { Router } from 'express';
import { createDonationCheckout } from '../lib/donations.js';

export function donateRouter(): Router {
  const router = Router();
  router.post('/', async (req, res) => {
    const result = await createDonationCheckout(req.body);
    res.status(result.statusCode).json(result.body);
  });
  return router;
}
