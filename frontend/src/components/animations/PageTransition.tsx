import { motion, AnimatePresence, Variants } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
  locationKey: string;
}

// Snappy, subtle transitions — fast enough not to add fatigue across a 9-step flow.
const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.1, ease: 'easeIn' } },
};

export default function PageTransition({ children, locationKey }: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={locationKey}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
