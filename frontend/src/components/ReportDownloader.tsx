import React, { useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Download, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export default function ReportDownloader({ targetId = "dashboard-content" }: { targetId?: string }) {
  const { projectName } = useAppContext();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    const element = document.getElementById(targetId);
    if (!element) {
      alert("Could not find the content to generate PDF from.");
      return;
    }

    setIsGenerating(true);
    try {
      // Temporarily add a class to ensure it captures fully visible
      const originalStyle = element.style.cssText;
      
      const canvas = await html2canvas(element, {
        scale: 2, // higher resolution
        useCORS: true,
        logging: false,
        backgroundColor: document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff',
      });

      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2] // match aspect ratio perfectly
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Bias_Report_${projectName || 'Project'}.pdf`);
      
    } catch (err) {
      console.error("PDF generation failed", err);
      alert("Failed to generate PDF. Check console for details.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={isGenerating}
      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
    >
      {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
      {isGenerating ? "Generating PDF..." : "Export PDF"}
    </button>
  );
}
