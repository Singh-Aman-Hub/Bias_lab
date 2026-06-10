import { motion, Variants } from 'framer-motion';

interface AnimatedCardProps {
  children: React.ReactNode;
  severity?: 'green' | 'amber' | 'red' | 'gray';
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1],
      delay: customDelay,
    },
  }),
};

const getSeverityColor = (sev: string) => {
  switch (sev) {
    case 'green': return '#34D6C4';
    case 'amber': return '#34D6C4';
    case 'red': return '#F0565B';
    default: return 'rgba(52, 214, 196, 0.25)';
  }
};

export default function AnimatedCard({ children, severity = 'gray', delay = 0, className = 'card', style }: AnimatedCardProps) {
  const borderColor = getSeverityColor(severity);

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      custom={delay}
      whileHover={{ 
        scale: 1.02, 
        borderColor: severity !== 'gray' ? borderColor : 'rgba(255, 255, 255, 0.1)',
        boxShadow: severity !== 'gray' ? `0 8px 32px ${borderColor}20` : '0 8px 32px rgba(0,0,0,0.2)'
      }}
      className={className}
      style={{
        ...style,
        borderTop: `4px solid ${borderColor}`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </motion.div>
  );
}
