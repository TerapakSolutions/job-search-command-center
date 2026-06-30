import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ToastBannerProps {
  message: string;
  visible: boolean;
  onClose: () => void;
  duration?: number;
}

export function ToastBanner({
  message,
  visible,
  onClose,
  duration = 3000,
}: ToastBannerProps) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, onClose, duration]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center"
        >
          <span className="mr-2">✅</span>
          <span className="flex-1">{message}</span>
          <button type="button" onClick={onClose} className="font-bold ml-4">
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
