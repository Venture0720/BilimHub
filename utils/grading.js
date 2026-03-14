// utils/grading.js
// Helper функции для работы с 10-бальной и 100-бальной шкалами оценивания

'use strict';

/**
 * Конвертация оценок между шкалами
 */
function convertScore(score, fromScale, toScale) {
  if (fromScale === toScale) return score;

  if (fromScale === '100-point' && toScale === '10-point') {
    // 100 → 10 (с округлением)
    return Math.round(score / 10);
  }

  if (fromScale === '10-point' && toScale === '100-point') {
    // 10 → 100
    return score * 10;
  }

  return score;
}

/**
 * Получить текстовую оценку на русском
 */
function getGradeLabel(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score >= 9) return 'Отлично';
    if (score >= 7) return 'Хорошо';
    if (score >= 5) return 'Удовлетворительно';
    if (score >= 3) return 'Неудовлетворительно';
    return 'Плохо';
  }

  if (scale === '100-point') {
    if (score >= 85) return 'Отлично';
    if (score >= 70) return 'Хорошо';
    if (score >= 50) return 'Удовлетворительно';
    if (score >= 30) return 'Неудовлетворительно';
    return 'Плохо';
  }

  return 'Не оценено';
}

/**
 * Получить цвет оценки (hex)
 */
function getGradeColor(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score >= 9) return '#10b981'; // зелёный
    if (score >= 7) return '#3b82f6'; // синий
    if (score >= 5) return '#f59e0b'; // оранжевый
    if (score >= 3) return '#ef4444'; // красный
    return '#991b1b'; // тёмно-красный
  }

  if (scale === '100-point') {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 50) return '#f59e0b';
    if (score >= 30) return '#ef4444';
    return '#991b1b';
  }

  return '#6b7280'; // серый (не оценено)
}

/**
 * Получить иконку для оценки
 */
function getGradeIcon(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score === 10) return '🏆';
    if (score >= 9) return '⭐';
    if (score >= 7) return '✨';
    if (score >= 5) return '👍';
    if (score >= 3) return '📝';
    return '😢';
  }

  if (scale === '100-point') {
    if (score >= 95) return '🏆';
    if (score >= 85) return '⭐';
    if (score >= 70) return '✨';
    if (score >= 50) return '👍';
    if (score >= 30) return '📝';
    return '😢';
  }

  return '❓';
}

/**
 * Валидация оценки
 */
function validateGrade(score, gradingScale = '10-point') {
  if (score === null || score === undefined) {
    throw new Error('Оценка не может быть пустой');
  }

  const numScore = parseFloat(score);

  if (isNaN(numScore)) {
    throw new Error('Оценка должна быть числом');
  }

  if (gradingScale === '10-point') {
    if (numScore < 1 || numScore > 10) {
      throw new Error('Оценка должна быть от 1 до 10');
    }
    // Для 10-бальной разрешаем дроби (например 8.5)
  } else if (gradingScale === '100-point') {
    if (numScore < 0 || numScore > 100) {
      throw new Error('Оценка должна быть от 0 до 100');
    }
  } else {
    throw new Error('Неизвестная шкала оценивания');
  }

  return numScore;
}

/**
 * Получить max_score на основе шкалы
 */
function getMaxScore(gradingScale) {
  return gradingScale === '10-point' ? 10 : 100;
}

/**
 * Получить процент от оценки
 */
function getScorePercentage(score, maxScore) {
  if (!score || !maxScore) return 0;
  return (score / maxScore) * 100;
}

/**
 * Генерация звёздочек для визуализации (только для 10-бальной)
 */
function generateStars(score, maxScore = 10) {
  if (maxScore !== 10) return null;

  const filledStars = Math.floor(score);
  const emptyStars = maxScore - filledStars;

  return '⭐'.repeat(filledStars) + '☆'.repeat(emptyStars);
}

module.exports = {
  convertScore,
  getGradeLabel,
  getGradeColor,
  getGradeIcon,
  validateGrade,
  getMaxScore,
  getScorePercentage,
  generateStars
};

